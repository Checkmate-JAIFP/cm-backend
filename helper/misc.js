module.exports.generateReturnMessage = (code, msg) => {
  return {
    statusCode: code,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
    },
    body: msg,
  };
};

module.exports.populateSentencesArray = (text) => {
  const split = /[.]\s/;

  let arr = [];
  let sentences = text.split(split);

  if (sentences[sentences.length - 1].slice(-1) === ".") {
    sentences[sentences.length - 1] = sentences[sentences.length - 1].slice(
      0,
      -1
    );
  }

  sentences.forEach((element) => {
    arr.push(`${element}.`);
  });

  return arr;
};
