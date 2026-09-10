const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { generateToken } = require('../utils/jwt');
const { sendVerificationOtp, sendPasswordResetOtp } = require('../services/email');

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getOtpExpiry() {
  return new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
}

// @desc    Start registration by sending an email OTP
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res, next) => {
  try {
    const { email, password, name, phone } = req.body;

    if (!email || !password || !name) {
      res.status(400);
      throw new Error('Please include all fields');
    }

    if (password.length < 6) {
      res.status(400);
      throw new Error('Password must be at least 6 characters');
    }

    // Check if user already exists
    const userExists = await prisma.user.findUnique({ where: { email } });
    if (userExists) {
      res.status(400);
      throw new Error('User already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const code = generateOtp();
    const expiresAt = getOtpExpiry();

    const existingOtp = await prisma.emailOtp.findUnique({ where: { email } });
    if (existingOtp) {
      await prisma.emailOtp.update({
        where: { email },
        data: { code, expiresAt, attempts: 0, passwordHash, name, phone },
      });
    } else {
      await prisma.emailOtp.create({
        data: { email, name, phone, passwordHash, code, expiresAt },
      });
    }

    await sendVerificationOtp({ email, code, name });

    res.status(200).json({
      success: true,
      message: 'Verification code sent to your email. Please enter it to complete registration.',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify email OTP and complete registration
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOtp = async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      res.status(400);
      throw new Error('Email and verification code are required');
    }

    const otpRecord = await prisma.emailOtp.findUnique({ where: { email } });
    if (!otpRecord) {
      res.status(400);
      throw new Error('No pending verification found');
    }

    if (new Date() > otpRecord.expiresAt) {
      res.status(400);
      throw new Error('Verification code has expired. Please request a new one.');
    }

    await prisma.emailOtp.update({
      where: { email },
      data: { attempts: { increment: 1 } },
    });

    if (otpRecord.attempts >= 5) {
      res.status(400);
      throw new Error('Too many failed attempts. Please request a new code.');
    }

    if (otpRecord.code !== code) {
      res.status(400);
      throw new Error('Invalid verification code');
    }

    // Create the user
    const user = await prisma.user.create({
      data: {
        email: otpRecord.email,
        password: otpRecord.passwordHash,
        name: otpRecord.name || null,
        phone: otpRecord.phone || null,
        isVerified: true,
      },
    });

    await prisma.emailOtp.delete({ where: { email } });

    res.status(201).json({
      success: true,
      message: 'Account verified and created successfully',
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        token: generateToken(user.id, user.role),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Resend verification OTP
// @route   POST /api/auth/resend-otp
// @access  Public
const resendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400);
      throw new Error('Email is required');
    }

    const otpRecord = await prisma.emailOtp.findUnique({ where: { email } });
    if (!otpRecord) {
      res.status(400);
      throw new Error('No pending verification found. Please register first.');
    }

    const code = generateOtp();
    const expiresAt = getOtpExpiry();

    await prisma.emailOtp.update({
      where: { email },
      data: { code, expiresAt, attempts: 0 },
    });

    await sendVerificationOtp({ email, code, name: otpRecord.name });

    res.status(200).json({
      success: true,
      message: 'A new verification code has been sent to your email.',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Authenticate a user
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400);
      throw new Error('Please include all fields');
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(401);
      throw new Error('Invalid credentials');
    }

    if (!user.isVerified) {
      res.status(403);
      throw new Error('Your email is not verified. Please verify your email first.');
    }

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        token: generateToken(user.id, user.role),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current logged-in user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        createdAt: true,
        membership: {
          select: {
            status: true,
            expiresAt: true,
            updatedAt: true,
            package: { select: { id: true, name: true, price: true, ticketLimit: true, durationMonths: true } },
          },
        },
      },
    });

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

// @desc    Send password reset OTP
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400);
      throw new Error('Email is required');
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Don't reveal whether email exists
      res.status(200).json({ success: true, message: 'If an account exists, a reset code has been sent.' });
      return;
    }

    const code = generateOtp();
    const expiresAt = getOtpExpiry();

    const existing = await prisma.passwordResetOtp.findUnique({ where: { email } });
    if (existing) {
      await prisma.passwordResetOtp.update({
        where: { email },
        data: { code, expiresAt, attempts: 0, used: false },
      });
    } else {
      await prisma.passwordResetOtp.create({
        data: { email, code, expiresAt },
      });
    }

    await sendPasswordResetOtp({ email, code, name: user.name });

    res.status(200).json({ success: true, message: 'If an account exists, a reset code has been sent.' });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify reset OTP and update password
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res, next) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      res.status(400);
      throw new Error('Email, code and new password are required');
    }
    if (newPassword.length < 6) {
      res.status(400);
      throw new Error('Password must be at least 6 characters');
    }

    const record = await prisma.passwordResetOtp.findUnique({ where: { email } });
    if (!record || record.used) {
      res.status(400);
      throw new Error('Invalid or expired reset code');
    }
    if (new Date() > record.expiresAt) {
      res.status(400);
      throw new Error('Reset code has expired');
    }
    if (record.attempts >= 5) {
      res.status(400);
      throw new Error('Too many attempts. Please request a new code.');
    }

    await prisma.passwordResetOtp.update({
      where: { email },
      data: { attempts: { increment: 1 } },
    });

    if (record.code !== code) {
      res.status(400);
      throw new Error('Invalid reset code');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { email },
      data: { password: passwordHash },
    });

    await prisma.passwordResetOtp.delete({ where: { email } });

    res.status(200).json({ success: true, message: 'Password reset successful. You can now log in.' });
  } catch (error) {
    next(error);
  }
};

// @desc    Send email verification OTP to existing unverified user
// @route   POST /api/auth/send-email-verification
// @access  Public
const sendEmailVerification = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400);
      throw new Error('Email is required');
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(404);
      throw new Error('No account found with this email.');
    }
    if (user.isVerified) {
      res.status(400);
      throw new Error('Your email is already verified. Please log in.');
    }

    const code = generateOtp();
    const expiresAt = getOtpExpiry();

    const existing = await prisma.emailOtp.findUnique({ where: { email } });
    if (existing) {
      await prisma.emailOtp.update({
        where: { email },
        data: { code, expiresAt, attempts: 0, passwordHash: user.password, name: user.name || '', phone: user.phone || '' },
      });
    } else {
      await prisma.emailOtp.create({
        data: { email, name: user.name || '', phone: user.phone || '', passwordHash: user.password, code, expiresAt },
      });
    }

    await sendVerificationOtp({ email, code, name: user.name });

    res.status(200).json({ success: true, message: 'Verification code sent to your email.' });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify email for existing unverified user
// @route   POST /api/auth/verify-email
// @access  Public
const verifyEmail = async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      res.status(400);
      throw new Error('Email and verification code are required');
    }

    const otpRecord = await prisma.emailOtp.findUnique({ where: { email } });
    if (!otpRecord) {
      res.status(400);
      throw new Error('No pending verification found');
    }

    if (new Date() > otpRecord.expiresAt) {
      res.status(400);
      throw new Error('Verification code has expired. Please request a new one.');
    }

    if (otpRecord.code !== code) {
      res.status(400);
      throw new Error('Invalid verification code');
    }

    await prisma.user.update({
      where: { email },
      data: { isVerified: true },
    });

    await prisma.emailOtp.delete({ where: { email } });

    res.status(200).json({ success: true, message: 'Email verified successfully. You can now log in.' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerUser,
  verifyOtp,
  resendOtp,
  loginUser,
  forgotPassword,
  resetPassword,
  sendEmailVerification,
  verifyEmail,
  getMe,
};
