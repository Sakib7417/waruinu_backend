const prisma = require('../utils/prisma');

// @desc    Create a consultation
// @route   POST /api/consultations
// @access  Private
const createConsultation = async (req, res, next) => {
  try {
    // Check if user has active membership with a valid package
    const membership = await prisma.membership.findUnique({
      where: { userId: req.user.id },
      include: { package: true },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      res.status(403);
      throw new Error('Active membership required');
    }

    if (membership.expiresAt && new Date(membership.expiresAt) < new Date()) {
      res.status(403);
      throw new Error('Your membership has expired');
    }

    // Only one active (non-closed) ticket at a time
    const activeTicket = await prisma.consultation.findFirst({
      where: { userId: req.user.id, status: { not: 'CLOSED' } },
    });
    if (activeTicket) {
      res.status(403);
      throw new Error('Please close your existing ticket before creating a new one');
    }

    if (membership.package?.ticketLimit) {
      const ticketCount = await prisma.consultation.count({
        where: {
          userId: req.user.id,
          createdAt: { gte: membership.updatedAt },
        },
      });
      if (ticketCount >= membership.package.ticketLimit) {
        res.status(403);
        throw new Error(`You have used all ${membership.package.ticketLimit} tickets in your ${membership.package.name} package`);
      }
    }

    const {
      motherName,
      dateOfBirthMonth,
      dateOfBirthYear,
      regularMenstrualCycle,
      underlyingCondition,
      underlyingConditionDetails,
      desiredGender,
      plannedConceptionYear,
    } = req.body;

    // Basic validation
    if (
      !motherName ||
      !dateOfBirthMonth ||
      !dateOfBirthYear ||
      regularMenstrualCycle === undefined ||
      underlyingCondition === undefined ||
      !desiredGender ||
      !plannedConceptionYear
    ) {
      res.status(400);
      throw new Error('Please provide all required fields');
    }

    if (desiredGender !== 'BOY' && desiredGender !== 'GIRL') {
      res.status(400);
      throw new Error('Desired gender must be BOY or GIRL');
    }

    const consultation = await prisma.consultation.create({
      data: {
        userId: req.user.id,
        motherName,
        dateOfBirthMonth,
        dateOfBirthYear: parseInt(dateOfBirthYear),
        regularMenstrualCycle: Boolean(regularMenstrualCycle),
        underlyingCondition: Boolean(underlyingCondition),
        underlyingConditionDetails: underlyingCondition ? underlyingConditionDetails : null,
        desiredGender,
        plannedConceptionYear: parseInt(plannedConceptionYear),
        status: 'PENDING',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Consultation submitted successfully',
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get user's consultations
// @route   GET /api/consultations
// @access  Private
const getConsultations = async (req, res, next) => {
  try {
    const consultations = await prisma.consultation.findMany({
      where: { userId: req.user.id },
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

// @desc    Get a single user consultation with messages
// @route   GET /api/consultations/:id
// @access  Private
const getConsultation = async (req, res, next) => {
  try {
    const consultation = await prisma.consultation.findUnique({
      where: { id: req.params.id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!consultation) {
      res.status(404);
      throw new Error('Consultation not found');
    }

    // Ensure it belongs to the logged in user
    if (consultation.userId !== req.user.id) {
      res.status(403);
      throw new Error('Not authorized to access this consultation');
    }

    res.status(200).json({
      success: true,
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add a message to a consultation (user side)
// @route   POST /api/consultations/:id/messages
// @access  Private
const createConsultationMessage = async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message || message.trim() === '') {
      res.status(400);
      throw new Error('Message is required');
    }

    const consultation = await prisma.consultation.findUnique({
      where: { id: req.params.id },
    });

    if (!consultation) {
      res.status(404);
      throw new Error('Consultation not found');
    }

    if (consultation.userId !== req.user.id) {
      res.status(403);
      throw new Error('Not authorized');
    }

    if (consultation.status === 'CLOSED') {
      res.status(400);
      throw new Error('Consultation is closed');
    }

    const [newMessage, updatedConsultation] = await prisma.$transaction([
      prisma.consultationMessage.create({
        data: {
          consultationId: consultation.id,
          sender: 'USER',
          message: message.trim(),
        },
      }),
      prisma.consultation.update({
        where: { id: consultation.id },
        data: { status: 'PENDING' },
      }),
    ]);

    res.status(201).json({
      success: true,
      data: newMessage,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createConsultation,
  getConsultations,
  getConsultation,
  createConsultationMessage,
};
