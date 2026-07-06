function employeeAge(req) {

    if (!req.data.dateOfBirth)
        return;

    const dob = new Date(req.data.dateOfBirth);

    const age =
        new Date().getFullYear() -
        dob.getFullYear();

    if (age < 18) {

        req.error(
            400,
            'Employee must be at least 18 years old.'
        );

    }

}

function futureJoining(req) {

    if (!req.data.joiningDate)
        return;

    const joining =
        new Date(req.data.joiningDate);

    if (joining > new Date()) {

        req.error(
            400,
            'Joining Date cannot be in the future.'
        );

    }

}

module.exports = {

    employeeAge,
    futureJoining

};