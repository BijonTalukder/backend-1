import express, { Router } from 'express';
import { authController } from '../controllers/auth.controller';

const route: Router = express.Router();
route.post("/auth/register", authController.register)
route.post("/auth/login", authController.login)


export default route;