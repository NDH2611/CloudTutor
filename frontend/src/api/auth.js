import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute
} from 'amazon-cognito-identity-js';
import { MOCK_USER } from './mockData';

// Configuration from environment variables
const poolData = {
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || 'ap-southeast-1_mockPoolId',
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || 'mockClientId123456789'
};

const isConfigured = 
  import.meta.env.VITE_COGNITO_USER_POOL_ID && 
  import.meta.env.VITE_COGNITO_CLIENT_ID &&
  import.meta.env.VITE_USE_MOCK !== 'true';

let userPool = null;
if (isConfigured) {
  try {
    userPool = new CognitoUserPool(poolData);
  } catch (err) {
    console.warn('Cognito SDK initialization fallback to mock mode:', err);
  }
}

/**
 * Login user using Cognito SDK or Mock fallback
 */
export async function sdkLogin(email, password) {
  // If not configured with live AWS Cognito, use robust mock authentication
  if (!userPool) {
    await new Promise((res) => setTimeout(res, 600)); // simulate network latency
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
            sub: payload.sub
          },
          idToken,
          accessToken,
          isMock: false
        });
      },
      onFailure: (err) => {
        reject(new Error(err.message || 'Cognito authentication failed'));
      },
      newPasswordRequired: (userAttributes, requiredAttributes) => {
        // Handle initial temporary password case if needed
        resolve({
          needsNewPassword: true,
          cognitoUser,
          userAttributes,
          requiredAttributes
        });
      }
    });
  });
}

/**
 * Register user using Cognito SDK or Mock fallback
 */
export async function sdkRegister(email, password, name = '') {
  if (!userPool) {
    await new Promise((res) => setTimeout(res, 700));
    return {
      userSub: `mock-sub-${Date.now()}`,
      userConfirmed: false,
      isMock: true,
      message: 'Mã xác thực đã được gửi giả lập tới email của bạn (Code: 123456)'
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
        reject(new Error(err.message || 'Cognito sign-up failed'));
        return;
      }
      resolve({
        userSub: result.userSub,
        userConfirmed: result.userConfirmed,
        isMock: false
      });
    });
  });
}

/**
 * Confirm registration code
 */
export async function sdkConfirmCode(email, code) {
  if (!userPool) {
    await new Promise((res) => setTimeout(res, 500));
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
        reject(new Error(err.message || 'Confirmation failed'));
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
