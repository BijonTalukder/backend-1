import jwt, { SignOptions, JwtPayload } from "jsonwebtoken";

/**
 * Generate JWT Token
 */
export const generateToken = (
  payload: object,
  secret: string,
  expiresIn: SignOptions["expiresIn"] = "1h"
): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!secret) {
      return reject(new Error("JWT secret is missing"));
    }

    jwt.sign(payload, secret, { expiresIn }, (err, token) => {
      if (err) return reject(err);
      if (!token) return reject(new Error("Token generation failed"));
      resolve(token);
    });
  });
};

/**
 * Verify JWT Token
 */
export const verifyToken = (
  token: string,
  secret: string
): JwtPayload | string => {
  if (!secret) {
    throw new Error("JWT secret is missing");
  }

  try {
    return jwt.verify(token, secret);
  } catch (error) {
    throw new Error("Token verification failed");
  }
};

/**
 * Decode Token (without verify)
 */
export const decodeToken = (
  token: string
): JwtPayload | string | null => {
  try {
    return jwt.decode(token);
  } catch (error) {
    throw new Error("Token decoding failed");
  }
};