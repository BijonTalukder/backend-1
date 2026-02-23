import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';

export class TokenHandler {
  // Generate a JWT token asynchronously
  generateToken(
    data: object,
    key: string,
    expiresIn: string | number = '1h',
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: SignOptions = { expiresIn: expiresIn as any };
      jwt.sign(data, key, options, (err, token) => {
        if (err || !token) {
          return reject(new Error('Token generation failed'));
        }
        resolve(token);
      });
    });
  }

  // Verify a JWT token
  verifyToken(token: string, key: string): JwtPayload | string {
    try {
      return jwt.verify(token, key);
    } catch (error) {
      throw new Error('Token verification failed');
    }
  }

  // Decode a JWT token without verifying
  decodeToken(token: string): null | { [key: string]: any } | string {
    try {
      return jwt.decode(token);
    } catch (error) {
      throw new Error('Token decoding failed');
    }
  }
}
