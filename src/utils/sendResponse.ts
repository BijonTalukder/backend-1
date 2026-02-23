import { Response } from 'express';

interface SendResponseData<T = any> {
  statusCode?: number;
  success?: boolean;
  message?: string | null;
  meta?: any;
  data?: T;
}

const sendResponse = <T = any>(
  res: Response,
  data: SendResponseData<T>,
): void => {
  console.log(data);

  const responseData = {
    statusCode: data.statusCode ?? 500,
    success: data.success ?? false,
    message: data.message ?? null,
    meta: data.meta ?? null,
    data: data.data ?? null,
  };

  res.status(responseData.statusCode).json(responseData);
};

export default sendResponse;
