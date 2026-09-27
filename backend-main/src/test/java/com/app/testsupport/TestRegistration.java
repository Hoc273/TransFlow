package com.app.testsupport;

import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.auth.service.RegisterOtpStore;

/** Registration now always requires an email OTP; tests seed one directly in the store. */
public final class TestRegistration {

    public static final String TEST_OTP = "123456";

    private TestRegistration() {
    }

    public static RegisterRequest withOtp(RegisterOtpStore store, RegisterRequest req) {
        store.saveOtp(req.email(), TEST_OTP);
        return new RegisterRequest(req.email(), req.password(), req.fullName(), TEST_OTP);
    }
}
