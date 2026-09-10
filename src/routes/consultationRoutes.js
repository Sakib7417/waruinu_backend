const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  createConsultation,
  getConsultations,
  getConsultation,
  createConsultationMessage,
} = require('../controllers/consultationController');

router.use(protect);

router.route('/')
  .post(createConsultation)
  .get(getConsultations);

router.route('/:id')
  .get(getConsultation);

router.route('/:id/messages')
  .post(createConsultationMessage);

module.exports = router;
