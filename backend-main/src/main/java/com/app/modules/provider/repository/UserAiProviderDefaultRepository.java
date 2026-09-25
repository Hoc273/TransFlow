package com.app.modules.provider.repository;

import com.app.modules.provider.entity.UserAiProviderDefault;
import com.app.modules.provider.entity.UserAiProviderDefaultId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface UserAiProviderDefaultRepository extends JpaRepository<UserAiProviderDefault, UserAiProviderDefaultId> {

    @Query("select d from UserAiProviderDefault d where d.id.userId = :userId")
    List<UserAiProviderDefault> findAllForUser(@Param("userId") UUID userId);

    @Query("select d from UserAiProviderDefault d where d.id.userId = :userId and d.id.capability = :capability")
    Optional<UserAiProviderDefault> findForCapability(@Param("userId") UUID userId,
                                                       @Param("capability") String capability);

    List<UserAiProviderDefault> findByProviderId(UUID providerId);

    @Modifying
    @Query("delete from UserAiProviderDefault d where d.id.userId = :userId and d.id.capability = :capability")
    void deleteForCapability(@Param("userId") UUID userId, @Param("capability") String capability);

    @Modifying
    @Query("delete from UserAiProviderDefault d where d.providerId = :providerId")
    void deleteForProvider(@Param("providerId") UUID providerId);
}
