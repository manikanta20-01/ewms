const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_REGEX = /^[0-9]{10}$/;

function validateEmployee(data) {

    if (!data.firstName)
        throw new Error("First Name is required.");

    if (!data.lastName)
        throw new Error("Last Name is required.");

    if (!data.email)
        throw new Error("Email is required.");

    if (!EMAIL_REGEX.test(data.email))
        throw new Error("Invalid email address.");

    if (data.mobile && !MOBILE_REGEX.test(data.mobile))
        throw new Error("Invalid mobile number.");

    if (!data.joiningDate)
        throw new Error("Joining Date is required.");

    const today = new Date();
    const joining = new Date(data.joiningDate);

    if (joining > today)
        throw new Error("Joining Date cannot be in the future.");

    if (data.dateOfBirth) {

        const dob = new Date(data.dateOfBirth);

        if (joining <= dob)
            throw new Error("Joining Date must be after Date of Birth.");

        let age = joining.getFullYear() - dob.getFullYear();

        const m = joining.getMonth() - dob.getMonth();

        if (m < 0 || (m === 0 && joining.getDate() < dob.getDate()))
            age--;

        if (age < 18)
            throw new Error(
                "Employee must be at least 18 years old."
            );
    }

}

module.exports = {
    validateEmployee
};