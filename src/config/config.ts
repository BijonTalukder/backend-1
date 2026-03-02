import dotenv from 'dotenv';

dotenv.config();

interface Config {
  port: number;
  nodeEnv: string;
  mongoURI: string;
  jwtSecret: string;
}

const config: Config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoURI: 'mongodb+srv://BookAppsAdmin:0cc2Y35qpKHH2eTE@cluster0.ywgnkn8.mongodb.net/BookApps?retryWrites=true&w=majority',
  jwtSecret: process.env.JWT_SECRET || 'secret',
};

export default config;
