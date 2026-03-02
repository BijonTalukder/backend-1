import mongoose from "mongoose";
import app from "./app";
import config from "./config/config";
// const port = 3000
async function boostrap() {
  try {
    await mongoose.connect(config.mongoURI as string);

    app.listen(config.port, () => {
      console.log(`Application app listening on port ${config.port}`)
    })

  }
  catch (e) {
    console.log("Failed to connect database")
  }


}
boostrap()