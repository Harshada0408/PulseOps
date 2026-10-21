import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

const devFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [CORE] [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  return msg;
});

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  defaultMeta: { service: 'pulseops' },
  format: combine(
    timestamp(),
    process.env.NODE_ENV === 'production' ? winston.format.json() : combine(colorize(), devFormat)
  ),
  transports: [
    new winston.transports.Console(),
    ...(process.env.NODE_ENV === 'production'
      ? [
          new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
          new winston.transports.File({ filename: 'logs/combined.log' }),
        ]
      : []),
  ],
});
