function success(data, message = "Success") {

    return {

        success: true,
        message,
        data

    };

}

function failure(message) {

    return {

        success: false,
        message

    };

}

module.exports = {

    success,
    failure

};