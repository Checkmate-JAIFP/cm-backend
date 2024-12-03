const { s3get, s3push, s3delete } = require("../helper/s3");
const { convertVideoToAudio } = require("../helper/mediaConvert");
const { generateReturnMessage } = require("../helper/misc");

exports.handler = async (event) => {
  try {
    const params = JSON.parse(event.Records[0].body);
    let video = [];
    let start = 0;
    let prevSegment;
    let stopBlock =
      params.stop -
      (params.stop % params.segmentSize) +
      (params.stop % params.segmentSize === 0 ? 0 : 10);

    if (params.stop % params.segmentSize === 0) {
      start = params.stop - params.segmentSize;
    } else {
      start = params.stop - (params.stop % params.segmentSize);
    }

    if (start > 0) {
      try {
        prevSegment = await s3get(
          `${params.id}/wip/${params.id}-${stopBlock - params.segmentSize}.webm`
        );
      } catch (error) {}
    }

    if (prevSegment) {
      video.push(prevSegment);

      await s3delete(
        `${params.id}/wip/${params.id}-${stopBlock - params.segmentSize}.webm`
      );
    }

    for (let i = start + 1; i <= params.stop; i++) {
      try {
        video.push(await s3get(`${params.id}/raw/${i}.webm`));
      } catch (error) {}
    }

    const blob = new Blob(video, { type: "video/webm" });

    await s3push(
      `${params.id}/wip/${params.id}-${stopBlock}.webm`,
      await blob.arrayBuffer()
    );

    await convertVideoToAudio(params.id, start, stopBlock);
  } catch (error) {
    console.error(error);
    return generateReturnMessage(
      500,
      "ERROR: Something went wrong on our side. Please contact support."
    );
  }

  return generateReturnMessage(200, "OKAY");
};
