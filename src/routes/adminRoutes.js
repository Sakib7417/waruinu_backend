const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const {
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
} = require('../controllers/adminController');

// All routes are protected and require admin role
router.use(protect, admin);

router.route('/packages')
  .get(getAdminPackages);

router.route('/packages/:id')
  .patch(updateAdminPackage);

router.route('/consultations')
  .get(getAdminConsultations);

router.route('/consultations/:id')
  .get(getAdminConsultation);

router.route('/consultations/:id/reply')
  .post(replyConsultation);

router.route('/consultations/:id/close')
  .patch(closeConsultation);

router.route('/dashboard')
  .get(getDashboardSummary);

router.route('/users')
  .get(getAdminUsers);

router.route('/payments')
  .get(getAdminPayments);

router.route('/payments/:id/verify')
  .post(verifyAdminPayment);

module.exports = router;
