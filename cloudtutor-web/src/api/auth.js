import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute
} from 'amazon-cognito-identity-js';
import { MOCK_USER } from './mockData';

// Configuration from environment variables
const poolData = {
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || ''
};

export const isCognitoConfigured = Boolean(
  import.meta.env.VITE_COGNITO_USER_POOL_ID && 
  import.meta.env.VITE_COGNITO_CLIENT_ID &&
  import.meta.env.VITE_USE_MOCK !== 'true'
);

export function getCognitoConfig() {
  const poolId = import.meta.env.VITE_COGNITO_USER_POOL_ID || '';
  const region = import.meta.env.VITE_COGNITO_REGION || (poolId.includes('_') ? poolId.split('_')[0] : 'ap-southeast-1');
  return {
    isConfigured: isCognitoConfigured,
    userPoolId: poolId,
    clientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '',
    region
  };
}

let userPool = null;
if (isCognitoConfigured) {
  try {
    userPool = new CognitoUserPool(poolData);
  } catch (err) {
    console.warn('Cognito SDK initialization error, fallback to mock mode:', err);
  }
}

/**
 * Translate standard AWS Cognito error messages to friendly Vietnamese
 */
export function translateCognitoError(err) {
  if (!err) return 'Lỗi xác thực không xác định';
  const code = err.code || err.name || '';
  const message = err.message || '';

  switch (code) {
    case 'UserNotFoundException':
      return 'Tài khoản không tồn tại trên hệ thống AWS Cognito.';
    case 'NotAuthorizedException':
      return 'Email hoặc mật khẩu không chính xác.';
    case 'UserNotConfirmedException':
      return 'Tài khoản chưa được kích hoạt mã OTP qua Email.';
    case 'PasswordResetRequiredException':
      return 'Mật khẩu cần được thiết lập lại trước khi đăng nhập.';
    case 'InvalidPasswordException':
      return 'Mật khẩu không đạt yêu cầu bảo mật của Cognito (tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, số, ký tự đặc biệt).';
    case 'UsernameExistsException':
      return 'Email này đã được đăng ký tài khoản trên AWS Cognito.';
    case 'CodeMismatchException':
      return 'Mã xác nhận OTP 6 số không chính xác.';
    case 'ExpiredCodeException':
      return 'Mã xác nhận OTP đã hết hạn. Vui lòng bấm gửi lại mã mới.';
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return 'Quá nhiều yêu cầu liên tiếp. Vui lòng đợi trong giây lát.';
    default:
      if (message.includes('Incorrect username or password')) {
        return 'Email hoặc mật khẩu không chính xác.';
      }
      return message || 'Lỗi kết nối tới AWS Cognito.';
  }
}

/**
 * Login user using Cognito SDK or Mock fallback
 */
export async function sdkLogin(email, password) {
  // If not configured with live AWS Cognito, use mock authentication
  if (!userPool) {
    await new Promise((res) => setTimeout(res, 500));
    if (password === 'fail') {
      throw new Error('Sai tài khoản hoặc mật khẩu (Incorrect username or password)');
    }
    const mockToken = `mock-cognito-jwt-${Date.now()}-${btoa(email)}`;
    const mockUser = {
      ...MOCK_USER,
      email: email,
      username: email.split('@')[0]
    };
    return {
      user: mockUser,
      idToken: mockToken,
      accessToken: `mock-access-${mockToken}`,
      isMock: true
    };
  }

  // Live Cognito SDK implementation
  return new Promise((resolve, reject) => {
    const authenticationDetails = new AuthenticationDetails({
      Username: email,
      Password: password
    });

    const cognitoUser = new CognitoUser({
      Username: email,
      Pool: userPool
    });

    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: (result) => {
        const idToken = result.getIdToken().getJwtToken();
        const accessToken = result.getAccessToken().getJwtToken();
        const payload = result.getIdToken().decodePayload();
        resolve({
          user: {
            username: payload['cognito:username'] || email,
            email: payload.email || email,
            sub: payload.sub,
            name: payload.name || payload.email || email
          },
          idToken,
          accessToken,
          isMock: false
        });
      },
      onFailure: (err) => {
        const customErr = new Error(translateCognitoError(err));
        customErr.code = err.code || err.name;
        reject(customErr);
      },
      newPasswordRequired: (userAttributes, requiredAttributes) => {
        const customErr = new Error('Tài khoản yêu cầu đổi mật khẩu lần đầu (FORCE_CHANGE_PASSWORD).');
        customErr.code = 'NewPasswordRequired';
        reject(customErr);
      }
    });
  });
}

/**
 * Register user using Cognito SDK or Mock fallback
 */
export async function sdkRegister(email, password, name = '') {
  if (!userPool) {
    await new Promise((res) => setTimeout(res, 600));
    return {
      userSub: `mock-sub-${Date.now()}`,
      userConfirmed: false,
      isMock: true,
      message: 'Mã xác thực giả lập đã được gửi (Nhập 123456)'
    };
  }

  return new Promise((resolve, reject) => {
    const attributeList = [];
    if (name) {
      attributeList.push(new CognitoUserAttribute({ Name: 'name', Value: name }));
    }
    attributeList.push(new CognitoUserAttribute({ Name: 'email', Value: email }));

    userPool.signUp(email, password, attributeList, null, (err, result) => {
      if (err) {
        const customErr = new Error(translateCognitoError(err));
        customErr.code = err.code || err.name;
        reject(customErr);
        return;
      }
      resolve({
        userSub: result.userSub,
        userConfirmed: result.userConfirmed,
        isMock: false,
        message: 'Mã xác thực đã được gửi về hòm thư Email của bạn từ AWS Cognito'
      });
    });
  });
}

/**
 * Confirm registration code (OTP verification)
 */
export async function sdkConfirmCode(email, code) {
  if (!userPool) {
    await new Promise((res) => setTimeout(res, 400));
    if (code !== '123456' && code.length !== 6) {
      throw new Error('Mã xác thực không hợp lệ. Gợi ý: nhập 123456 trong chế độ Mock.');
    }
    return { success: true, isMock: true };
  }

  return new Promise((resolve, reject) => {
    const cognitoUser = new CognitoUser({
      Username: email,
      Pool: userPool
    });

    cognitoUser.confirmRegistration(code, true, (err, result) => {
      if (err) {
        const customErr = new Error(translateCognitoError(err));
        customErr.code = err.code || err.name;
        reject(customErr);
        return;
      }
      resolve({ success: true, result });
    });
  });
}

/**
 * Resend confirmation OTP
 */
export async function sdkResendCode(email) {
  if (!userPool) {
    await new Promise((res) => setTimeout(res, 300));
    return { success: true, isMock: true, message: 'Mã xác thực mới là 123456' };
  }

  return new Promise((resolve, reject) => {
    const cognitoUser = new CognitoUser({
      Username: email,
      Pool: userPool
    });

    cognitoUser.resendConfirmationCode((err, result) => {
      if (err) {
        const customErr = new Error(translateCognitoError(err));
        customErr.code = err.code || err.name;
        reject(customErr);
        return;
      }
      resolve({ success: true, result });
    });
  });
}

/**
 * Logout
 */
export function sdkLogout(email) {
  if (userPool && email) {
    const cognitoUser = new CognitoUser({
      Username: email,
      Pool: userPool
    });
    cognitoUser.signOut();
  }
}
