function futureDate(req, field, label) {

    if (!req.data[field]) return;

    const today = new Date();
    const value = new Date(req.data[field]);

    if (value > today) {
        req.error(400, `${label} cannot be in the future.`);
    }

}

function startBeforeEnd(req, start, end) {

    if (!req.data[start] || !req.data[end])
        return;

    const s = new Date(req.data[start]);
    const e = new Date(req.data[end]);

    if (s > e) {

        req.error(400, "Start Date must be before End Date.");

    }

}

module.exports = {
    futureDate,
    startBeforeEnd
};