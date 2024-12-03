const {
  MediaConvertClient,
  CreateJobCommand,
} = require("@aws-sdk/client-mediaconvert");

const { secondsToTimecode } = require("../helper/timecalc");

const client = new MediaConvertClient({ region: "eu-central-1" });

module.exports.convertVideoToAudio = async (videoId, start, stop) => {
  try {
    let playhead = start;
    const overhead = 1;

    if (start > 0) {
      playhead = start - overhead;
    }

    const params = {
      Queue:
        "arn:aws:mediaconvert:eu-central-1:516400917338:queues/cm-mediaConvert",
      UserMetadata: {},
      Role: "arn:aws:iam::516400917338:role/service-role/cm-mediaconvert",
      Settings: {
        TimecodeConfig: {
          Source: "ZEROBASED",
        },
        OutputGroups: [
          {
            Name: "File Group",
            Outputs: [
              {
                ContainerSettings: {
                  Container: "RAW",
                },
                AudioDescriptions: [
                  {
                    AudioSourceName: "Audio Selector 1",
                    CodecSettings: {
                      Codec: "MP3",
                      Mp3Settings: {
                        Bitrate: 96000,
                        Channels: 1,
                        RateControlMode: "CBR",
                        SampleRate: 44100,
                      },
                    },
                  },
                ],
              },
            ],
            OutputGroupSettings: {
              Type: "FILE_GROUP_SETTINGS",
              FileGroupSettings: {
                Destination: `s3://cm-backend-dev-audiochunks/${videoId}/${videoId}-${start}-${stop}`,
              },
            },
          },
        ],
        FollowSource: 1,
        Inputs: [
          {
            InputClippings: [
              {
                EndTimecode: `${await secondsToTimecode(stop)}:00`,
                StartTimecode: `${await secondsToTimecode(playhead)}:00`,
              },
            ],
            AudioSelectors: {
              "Audio Selector 1": {
                DefaultSelection: "DEFAULT",
              },
            },
            TimecodeSource: "ZEROBASED",
            FileInput: `s3://cm-backend-dev-chunks/${videoId}/wip/${videoId}-${stop}.webm`,
          },
        ],
      },
      BillingTagsSource: "JOB",
      AccelerationSettings: {
        Mode: "DISABLED",
      },
      StatusUpdateInterval: "SECONDS_60",
      Priority: 0,
    };

    const command = new CreateJobCommand(params);
    const response = await client.send(command);

    return response;
  } catch (error) {
    console.error("MediaConvert Error:", error);
    return false;
  }
};
