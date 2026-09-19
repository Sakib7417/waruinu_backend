const prisma = require('../utils/prisma');
const { checkPaymentStatus } = require('../services/intasend');
const { activateMembership } = require('./membershipController');

// @desc    Get all membership packages
// @route   GET /api/admin/packages
// @access  Private/Admin
const getAdminPackages = async (req, res, next) => {
  try {
    const packages = await prisma.membershipPackage.findMany({
      orderBy: { price: 'asc' },
    });
    res.status(200).json({ success: true, data: packages });
  } catch (error) {
    next(error);
  }
};

// @desc    Update a membership package
// @route   PATCH /api/admin/packages/:id
// @access  Private/Admin
const updateAdminPackage = async (req, res, next) => {
  try {
    const { price, ticketLimit, durationMonths, isActive } = req.body;
    const package = await prisma.membershipPackage.update({
      where: { id: req.params.id },
      data: {
        ...(price !== undefined && { price: Number(price) }),
        ...(ticketLimit !== undefined && { ticketLimit: ticketLimit === null ? null : Number(ticketLimit) }),
        ...(durationMonths !== undefined && { durationMonths: durationMonths === null ? null : Number(durationMonths) }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    res.status(200).json({ success: true, data: package });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all consultations
// @route   GET /api/admin/consultations
// @access  Private/Admin
const getAdminConsultations = async (req, res, next) => {
  try {
    const consultations = await prisma.consultation.findMany({
      include: {
        user: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json({
      success: true,
      data: consultations,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single consultation
// @route   GET /api/admin/consultations/:id
// @access  Private/Admin
const getAdminConsultation = async (req, res, next) => {
  try {
    const consultation = await prisma.consultation.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { email: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!consultation) {
      res.status(404);
      throw new Error('Consultation not found');
    }

    res.status(200).json({
      success: true,
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reply to consultation (adds an admin message)
// @route   POST /api/admin/consultations/:id/reply
// @access  Private/Admin
const replyConsultation = async (req, res, next) => {
  try {
    const { adminResponse } = req.body;
    if (!adminResponse || adminResponse.trim() === '') {
      res.status(400);
      throw new Error('Please provide a response');
    }

    const consultation = await prisma.consultation.findUnique({
      where: { id: req.params.id },
    });

    if (!consultation) {
      res.status(404);
      throw new Error('Consultation not found');
    }

    const [message, updatedConsultation] = await prisma.$transaction([
      prisma.consultationMessage.create({
        data: {
          consultationId: consultation.id,
          sender: 'ADMIN',
          message: adminResponse.trim(),
        },
      }),
      prisma.consultation.update({
        where: { id: req.params.id },
        data: {
          adminResponse: adminResponse.trim(),
          status: 'ANSWERED',
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      message: 'Replied to consultation successfully',
      data: { message, consultation: updatedConsultation },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Close consultation
// @route   PATCH /api/admin/consultations/:id/close
// @access  Private/Admin
const closeConsultation = async (req, res, next) => {
  try {
    const consultation = await prisma.consultation.findUnique({
      where: { id: req.params.id },
    });

    if (!consultation) {
      res.status(404);
      throw new Error('Consultation not found');
    }

    const updatedConsultation = await prisma.consultation.update({
      where: { id: req.params.id },
      data: { status: 'CLOSED' },
    });

    res.status(200).json({
      success: true,
      message: 'Consultation closed successfully',
      data: updatedConsultation,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get dashboard summary
// @route   GET /api/admin/dashboard
// @access  Private/Admin
const getDashboardSummary = async (req, res, next) => {
  try {
    const totalUsers = await prisma.user.count({ where: { role: 'USER' } });
    const pendingConsultations = await prisma.consultation.count({ where: { status: 'PENDING' } });
    const answeredConsultations = await prisma.consultation.count({ where: { status: 'ANSWERED' } });
    const closedConsultations = await prisma.consultation.count({ where: { status: 'CLOSED' } });

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        pendingConsultations,
        answeredConsultations,
        closedConsultations,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private/Admin
const getAdminUsers = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: 'USER' },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        createdAt: true,
        membership: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify a pending payment and activate membership (admin only)
// @route   POST /api/admin/payments/:id/verify
// @access  Private/Admin
const verifyAdminPayment = async (req, res, next) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
    });

    if (!payment) {
      res.status(404);
      throw new Error('Payment not found');
    }

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

    const invoiceId = payment.transactionReference;
    if (!invoiceId || invoiceId === 'SIMULATED') {
      res.status(400);
      throw new Error('No IntaSend invoice linked to this payment');
    }

    const result = await checkPaymentStatus(invoiceId);

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

    return res.status(200).json({
      success: true,
      message: 'Payment is still pending',
      data: { paymentId: payment.id, status: 'PENDING', state: result.state },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all payments
// @route   GET /api/admin/payments
// @access  Private/Admin
const getAdminPayments = async (req, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { email: true } },
      },
    });

    res.status(200).json({ success: true, data: payments });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAdminPackages,
  updateAdminPackage,
  getAdminUsers,
  getAdminPayments,
  getAdminConsultations,
  getAdminConsultation,
  replyConsultation,
  closeConsultation,
  getDashboardSummary,
  verifyAdminPayment,
};
