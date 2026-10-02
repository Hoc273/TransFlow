package com.app.modules.platform.service.impl;

import com.app.modules.platform.repository.PlatformUserViewRepository;
import com.app.modules.platform.repository.UserActivityLogRepository;
import com.app.modules.platform.service.PlatformAdminAccessService;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserActivityLogServiceImplTest {

    /** H2 accepts a null q, PostgreSQL binds it as bytea and locate() fails — never pass null. */
    @Test
    void missingSearchIsSentAsEmptyStringNotNull() {
        UserActivityLogRepository repository = mock(UserActivityLogRepository.class);
        when(repository.search(any(), any(), any(), anyBoolean(), any(Pageable.class))).thenReturn(Page.empty());
        UserActivityLogServiceImpl service = new UserActivityLogServiceImpl(repository,
                mock(PlatformUserViewRepository.class), mock(PlatformAdminAccessService.class), 90);

        service.list(UUID.randomUUID(), null, null, null, false, null, null);
        service.list(UUID.randomUUID(), null, null, "  Login ", false, null, null);

        verify(repository).search(isNull(), isNull(), eq(""), eq(false), any(Pageable.class));
        verify(repository).search(isNull(), isNull(), eq("login"), eq(false), any(Pageable.class));
    }
}
