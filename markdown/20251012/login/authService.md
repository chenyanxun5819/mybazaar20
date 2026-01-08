async function loginWithPin(phoneNumber, password, organizationId, eventId) {
  try {
    // ... 验证代码保持不变 ...

    console.log('[authService] Calling loginWithPin function');
    
    const loginWithPinFn = httpsCallable(functions, 'loginWithPin');
    
    const result = await loginWithPinFn({ 
      phoneNumber: normalized, 
      pin: password,
      organizationId,
      eventId
    });

    console.log('[authService] Function call result:', result);

    const data = result.data;
    const customToken = data?.customToken;

    if (!customToken) {
      console.error('[authService] No custom token in response:', data);
      throw new Error(data?.message || '密码验证失败');
    }

    console.log('[authService] Got custom token, signing in...');
    
    await signInWithCustomToken(auth, customToken);

    console.log('[authService] Login successful');
    
    // 🔥 返回包含用户资料的结果
    return {
      success: true,
      user: data,
      userProfile: data.userProfile,  // 从登录结果中获取
      message: '登录成功'
    };
  } catch (error) {
    // ... 错误处理保持不变 ...
  }
}