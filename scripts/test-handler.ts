import { handler } from '../src/handlers/moderate.handler.js'
process.env.IMAGES_BUCKET_NAME = "test-bucket";

const event = {
  body: JSON.stringify({
    imageKey: "uploads/test.jpg",
  }),
};

const result = await handler(event as never);

console.log(result);