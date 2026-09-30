exports.handler = async (event) => {
  console.log("Lambda Worker nhận được message từ SQS:");
  for (const record of event.Records) {
    console.log("Nội dung message:", record.body);
  }
  return { statusCode: 200 };
};