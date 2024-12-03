const { AssemblyAI } = require("assemblyai");
const { getAuth } = require("helper/awsauth");

const callback =
  "https://8xvtslnppb.execute-api.eu-central-1.amazonaws.com/dev/callback/assemblyai";
module.exports.submitAudioToTranscriptionService = async (url) => {
  const auth = await getAuth();

  const client = new AssemblyAI({
    apiKey: auth.ASSEMBLYAI_API_KEY,
  });

  const data = {
    audio_url: url,
    speech_model: "best",
    language_detection: true,
    speaker_labels: false,
    webhook_url: callback,
  };

  const process = await client.transcripts.submit(data);
  return process;
};

module.exports.getTranscription = async (id, auth) => {
  const client = new AssemblyAI({
    apiKey: auth,
  });

  const transcript = await client.transcripts.get(id, auth);
  return transcript;
};
