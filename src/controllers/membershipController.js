const prisma = require('../utils/prisma');
const { initiateCheckout, checkPaymentStatus } = require('../services/intasend');

// @desc    Get membership packages
// @route   GET /api/membership/packages
// @access  Public or Private
const getMembershipPackages = async (req, res, next) => {
  try {
    const packages = await prisma.membershipPackage.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });
    res.status(200).json({ success: true, data: packages });
  } catch (error) {
    next(error);
  }
};

// @desc    Initiate M-Pesa payment for a package
// @route   POST /api/membership/pay
// @access  Private
const initiatePayment = async (req, res, next) => {
  try {
    const { phoneNumber, packageId } = req.body;
    if (!packageId) {
      res.status(400);
      throw new Error('Please select a membership package');
    }

    const pkg = await prisma.membershipPackage.findUnique({
      where: { id: packageId },
    });
    if (!pkg || !pkg.isActive) {
      res.status(400);
      throw new Error('Invalid membership package selected');
    }

    // Check if user already has an active, non-exhausted membership
    const existing = await prisma.membership.findUnique({
      where: { userId: req.user.id },
      include: { package: true },
    });
    if (existing && existing.status === 'ACTIVE') {
      const expired = existing.expiresAt && new Date(existing.expiresAt) < new Date();
      if (!expired) {
        let exhausted = false;
        if (existing.package?.ticketLimit) {
          const usedSince = await prisma.consultation.count({
            where: {
              userId: req.user.id,
              createdAt: { gte: existing.updatedAt },
            },
          });
          exhausted = usedSince >= existing.package.ticketLimit;
        }
        if (!exhausted) {
          // Allow upgrading to a higher-priced plan, block same or lower plans
          if (existing.package && pkg.price <= existing.package.price) {
            res.status(403);
            throw new Error('Your current plan is still active. You can only upgrade to a higher plan.');
          }
        }
      }
    }

    // 1. Create PENDING payment record
    const payment = await prisma.payment.create({
      data: {
        userId: req.user.id,
        packageId: pkg.id,
        amount: pkg.price,
        currency: pkg.currency,
        status: 'PENDING',
      },
    });

    // 2. Initiate IntaSend checkout
    const redirectUrl = process.env.INTASEND_REDIRECT_URL;
    const callbackUrl = process.env.INTASEND_CALLBACK_URL;
    if (!redirectUrl || !callbackUrl) {
      res.status(500);
      throw new Error('IntaSend redirect or callback URL is not configured');
    }

    let checkout;
    try {
      checkout = await initiateCheckout({
        amount: payment.amount,
        currency: payment.currency,
        email: req.user.email,
        name: req.user.name || req.user.email,
        phoneNumber,
        apiRef: payment.id,
        redirectUrl,
        callbackUrl,
      });
    } catch (checkoutError) {
      // Checkout failed — remove the pending record so it can't be simulated later
      await prisma.payment.delete({ where: { id: payment.id } });
      throw checkoutError;
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: { transactionReference: checkout.invoiceId },
    });

    res.status(200).json({
      success: true,
      message: 'Redirecting to payment checkout.',
      data: {
        paymentId: payment.id,
        amount: payment.amount,
        redirectUrl: checkout.checkoutUrl,
      },
    });
  } catch (error) {
    next(error);
  }
};

async function activateMembership(userId, packageId) {
  const pkg = await prisma.membershipPackage.findUnique({
    where: { id: packageId },
  });
  if (!pkg) return;

  const now = new Date();
  let expiresAt = null;
  if (pkg.durationMonths) {
    expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + pkg.durationMonths);
  }

  const existingMembership = await prisma.membership.findUnique({
    where: { userId },
  });

  // Idempotent: skip if already active on the same package
  if (
    existingMembership &&
    existingMembership.status === 'ACTIVE' &&
    existingMembership.packageId === pkg.id
  ) {
    return;
  }

  if (existingMembership) {
    await prisma.membership.update({
      where: { userId },
      data: { packageId: pkg.id, status: 'ACTIVE', expiresAt },
    });
  } else {
    await prisma.membership.create({
      data: {
        userId,
        packageId: pkg.id,
        status: 'ACTIVE',
        expiresAt,
      },
    });
  }
}

// @desc    Simulate successful M-Pesa payment (development only)
// @route   POST /api/membership/simulate
// @access  Private
const simulatePayment = async (req, res, next) => {
  try {
    // Only allow in non-production / sandbox
    if (process.env.NODE_ENV === 'production' && process.env.MPESA_SHORTCODE !== '174379') {
      res.status(403);
      throw new Error('Simulation not allowed in production');
    }

    const { packageId } = req.body;

    let pkg;
    let payment = await prisma.payment.findFirst({
      where: { userId: req.user.id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    if (payment) {
      pkg = payment.packageId ? await prisma.membershipPackage.findUnique({ where: { id: payment.packageId } }) : null;
    }

    if (!payment || !pkg) {
      // No pending payment or package — create a simulated one for testing
      if (packageId) {
        pkg = await prisma.membershipPackage.findUnique({ where: { id: packageId } });
      }
      if (!pkg) {
        pkg = await prisma.membershipPackage.findFirst({ where: { isActive: true }, orderBy: { price: 'asc' } });
      }
      if (!pkg) {
        res.status(400);
        throw new Error('No active membership package found');
      }

      payment = await prisma.payment.create({
        data: {
          userId: req.user.id,
          packageId: pkg.id,
          amount: pkg.price,
          currency: pkg.currency,
          status: 'PENDING',
          transactionReference: 'SIMULATED',
        },
      });
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'SUCCESS', transactionReference: payment.transactionReference || 'SIMULATED' },
    });

    await activateMembership(req.user.id, pkg.id);

    res.status(200).json({
      success: true,
      message: 'Payment simulated as successful',
      data: { paymentId: payment.id },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get user's payment history
// @route   GET /api/membership/payments
// @access  Private
const getUserPayments = async (req, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        transactionReference: true,
        createdAt: true,
        package: { select: { name: true } },
      },
    });

    res.status(200).json({ success: true, data: payments });
  } catch (error) {
    next(error);
  }
};

// @desc    IntaSend webhook callback
// @route   POST /api/membership/callback
// @access  Public
const mpesaCallback = async (req, res, next) => {
  try {
    const body = req.body;
    const { invoice_id, state, failed_reason } = body;

    if (!invoice_id || !state) {
      return res.status(400).json({ success: false, message: 'Invalid callback data' });
    }

    // Optional webhook challenge validation
    const expectedChallenge = process.env.INTASEND_WEBHOOK_CHALLENGE;
    if (expectedChallenge && body.challenge && body.challenge !== expectedChallenge) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // The webhook sends api_ref (our payment.id / checkout UUID) as well as invoice_id.
    // We initially store the checkout UUID as transactionReference, so find by api_ref.
    const where = body.api_ref
      ? { transactionReference: body.api_ref }
      : { transactionReference: invoice_id };

    const payment = await prisma.payment.findFirst({
      where,
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    // Update the stored transactionReference to the actual IntaSend invoice_id
    const updateData = { status: state === 'COMPLETE' ? 'SUCCESS' : state };
    if (invoice_id) {
      updateData.transactionReference = invoice_id;
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: updateData,
    });

    // Only process final states
    if (state === 'PENDING' || state === 'PROCESSING') {
      return res.status(200).json({ success: true, message: 'Callback received' });
    }

    if (state === 'COMPLETE') {
      if (payment.packageId) {
        await activateMembership(payment.userId, payment.packageId);
      } else {
        // Fallback: find first active package (legacy payments)
        const pkg = await prisma.membershipPackage.findFirst({
          where: { isActive: true },
          orderBy: { price: 'asc' },
        });
        if (pkg) await activateMembership(payment.userId, pkg.id);
      }
    }

    res.status(200).json({ success: true, message: 'Callback received' });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify payment status (fallback for webhook)
// @route   POST /api/membership/verify-payment
// @access  Private
const verifyPayment = async (req, res, next) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) {
      res.status(400);
      throw new Error('paymentId is required');
    }

    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, userId: req.user.id },
    });

    if (!payment) {
      res.status(404);
      throw new Error('Payment not found');
    }

    // If payment is already marked SUCCESS, just (re)activate membership and return
    if (payment.status === 'SUCCESS') {
      if (payment.packageId) {
        await activateMembership(payment.userId, payment.packageId);
      }
      return res.status(200).json({
        success: true,
        message: 'Payment already confirmed',
        data: { paymentId: payment.id, status: 'SUCCESS' },
      });
    }

    // Otherwise query IntaSend for the live status using the invoice id
    const invoiceId = payment.transactionReference;
    if (!invoiceId || invoiceId === 'SIMULATED') {
      res.status(400);
      throw new Error('No IntaSend invoice linked to this payment');
    }

    const result = await checkPaymentStatus(invoiceId, payment.id);

    if (result.state === 'COMPLETE') {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCESS' },
      });

      if (payment.packageId) {
        await activateMembership(payment.userId, payment.packageId);
      }

      return res.status(200).json({
        success: true,
        message: 'Payment confirmed and membership activated',
        data: { paymentId: payment.id, status: 'SUCCESS', state: result.state },
      });
    }

    if (result.state === 'FAILED') {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      return res.status(200).json({
        success: true,
        message: 'Payment failed',
        data: { paymentId: payment.id, status: 'FAILED', state: result.state, failedReason: result.failedReason },
      });
    }

    // Still pending/processing
    return res.status(200).json({
      success: true,
      message: 'Payment is still pending',
      data: { paymentId: payment.id, status: 'PENDING', state: result.state },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMembershipPackages,
  initiatePayment,
  simulatePayment,
  verifyPayment,
  getUserPayments,
  mpesaCallback,
  activateMembership,
};
