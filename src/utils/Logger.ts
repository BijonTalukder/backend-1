import { createLogger, format, transports } from 'winston';
import path from 'path';

const { combine, timestamp, printf, colorize, errors, json } = format;

const consoleFormat = printf(({ level, message, timestamp, stack }) => {
  if (stack) {
    return `${timestamp} [${level}]: ${stack}`;
  }
  return `${timestamp} [${level}]: ${message}`;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  ),
  transports: [
    new transports.Console({
      format: combine(colorize({ all: true }), consoleFormat),
      silent: process.env.NODE_ENV === 'test',
    }),
    new transports.File({
      filename: path.resolve(process.env.LOG_FILE || 'logs/app.log'),
      format: combine(json()),
      maxsize: 5_242_880,
      maxFiles: 5,
      tailable: true,
    }),
    new transports.File({
      filename: path.resolve('logs/error.log'),
      level: 'error',
      format: combine(json()),
      maxsize: 5_242_880,
      maxFiles: 5,
      tailable: true,
    }),
  ],
  exitOnError: false,
});

export default logger;
