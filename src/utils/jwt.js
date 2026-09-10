const jwt = require('jsonwebtoken');

const generateToken = (userId, role) => {
  return jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET || 'supersecretjwtkey',
    { expiresIn: '30d' }
  );
};

const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET || 'supersecretjwtkey');
};

module.exports = {
  generateToken,
  verifyToken
};
