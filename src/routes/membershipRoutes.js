const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getMembershipPackages,
  initiatePayment,
  simulatePayment,
  getUserPayments,
  mpesaCallback,
} = require('../controllers/membershipController');

// Public route for callback
router.post('/callback', mpesaCallback);

// Protected routes
router.get('/packages', protect, getMembershipPackages);
router.post('/pay', protect, initiatePayment);
router.post('/simulate', protect, simulatePayment);
router.get('/payments', protect, getUserPayments);

module.exports = router;
