const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9]{10}$/;

function required(req, field, label) {
  if (
    req.data[field] === undefined ||
    req.data[field] === null ||
    req.data[field] === ""
  ) {
    req.error(400, `${label} is required.`);
  }
}

function email(req, field = "email") {
  if (req.data[field] && !EMAIL_REGEX.test(req.data[field])) {
    req.error(400, "Invalid email address.");
  }
}

function phone(req, field = "mobile") {
  if (req.data[field] && !PHONE_REGEX.test(req.data[field])) {
    req.error(400, "Invalid mobile number.");
  }
}

function positive(req, field, label) {
  if (req.data[field] !== undefined && Number(req.data[field]) <= 0) {
    req.error(400, `${label} must be greater than zero.`);
  }
}

module.exports = {
  required,
  email,
  phone,
  positive,
};
