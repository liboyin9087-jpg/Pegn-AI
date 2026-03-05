import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Pegn AI WorkOS API',
      version: '1.0.0',
      description: '企業級 AI 工作系統 REST API — 包含認證、Agent 執行、帳單、Webhooks、Prompts 等核心模組。',
      contact: {
        name: 'Pegn AI',
        url: 'https://github.com/liboyin9087-jpg/Pegn-AI',
      },
    },
    servers: [
      { url: 'http://localhost:4000', description: '本地開發' },
      { url: 'https://api.pegn.ai', description: '生產環境' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: '使用 POST /api/v1/auth/login 取得 JWT token，格式為 `Authorization: Bearer <token>`',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', description: '錯誤訊息' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  // 掃描所有 route 檔案中的 @openapi JSDoc 注解
  apis: ['./src/routes/*.ts', './src/routes/*.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
