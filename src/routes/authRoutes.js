const express = require('express');
const router = express.Router();
const { registerUser, verifyOtp, resendOtp, loginUser, forgotPassword, resetPassword, sendEmailVerification, verifyEmail, getMe } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', registerUser);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.post('/login', loginUser);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/send-email-verification', sendEmailVerification);
router.post('/verify-email', verifyEmail);
router.get('/me', protect, getMe);

module.exports = router;
