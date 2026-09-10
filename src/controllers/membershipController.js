const prisma = require('../utils/prisma');
const { initiateStkPush, formatPhone } = require('../services/mpesa');

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
    if (!phoneNumber) {
      res.status(400);
      throw new Error('Phone number is required for M-Pesa payment');
    }
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
          res.status(403);
          throw new Error('Your current plan is still active. You can buy a new plan after your tickets are used or it expires.');
        }
      }
    }

    // Normalize the phone number first
    const formatted = formatPhone(phoneNumber);
    if (!formatted.startsWith('254') || formatted.length !== 12) {
      res.status(400);
      throw new Error('Invalid phone number. Use 07XX XXX XXX or 2547XX XXX XXX.');
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

    // 2. Initiate real M-Pesa STK Push
    let stk;
    try {
      stk = await initiateStkPush(payment.amount, formatted);
    } catch (stkError) {
      // STK push failed — remove the pending record so it can't be simulated later
      await prisma.payment.delete({ where: { id: payment.id } });
      throw stkError;
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: { transactionReference: stk.checkoutRequestId },
    });

    res.status(200).json({
      success: true,
      message: 'Payment initiated. Please check your phone.',
      data: {
        paymentId: payment.id,
        amount: payment.amount,
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

// @desc    M-Pesa Callback
// @route   POST /api/membership/callback
// @access  Public
const mpesaCallback = async (req, res, next) => {
  try {
    const body = req.body;
    const stkCallback = body?.Body?.stkCallback;

    if (!stkCallback) {
      return res.status(400).json({ success: false, message: 'Invalid callback data' });
    }

    const resultCode = stkCallback.ResultCode;
    const checkoutRequestId = stkCallback.CheckoutRequestID;

    const payment = await prisma.payment.findFirst({
      where: { transactionReference: checkoutRequestId },
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    if (String(resultCode) === '0') {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCESS' },
      });

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
    } else {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
    }

    res.status(200).json({ success: true, message: 'Callback received' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMembershipPackages,
  initiatePayment,
  simulatePayment,
  getUserPayments,
  mpesaCallback,
};
