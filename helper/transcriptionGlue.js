module.exports.glueTranscripts = async (firstArray, secondArray) => {
  return glueArrays(firstArray, secondArray);
};

function glueArrays(array1, array2) {
  let changes = 0;
  let glue1 = [];
  let glue2 = [];

  array1.forEach(function (element, i) {
    if (element.start > 9000) {
      glue1.push({
        index: i,
        text: element.text,
      });
    }
  });

  array2.forEach(function (element, i) {
    if (element.start < 2000) {
      glue2.push({
        index: i,
        text: element.text,
      });
    }
  });

  let matches = [];

  glue1.forEach(function (element1, i1) {
    glue2.forEach(function (element2, i2) {
      let winner = 2;
      const raw1 = element1.text.toLowerCase().replace(".", "");
      const raw2 = element2.text.toLowerCase().replace(".", "");

      if (raw1 === raw2) {
        if (element1.text.slice(-1) === ".") {
          winner = 1;
        }
        matches.push({
          index1: element1.index,
          index2: element2.index,
          winner: winner,
        });
      }
    });
  });

  if (matches.length > 0) {
    let cutoff1 = matches[0].index1;
    let cutoff2 = matches[0].index2;
    matches.forEach(function (element, i) {
      if (element.winner === 2) {
        cutoff1 = element.index1;
        cutoff2 = element.index2;
      }
    });
    array1 = array1.slice(0, cutoff1 + 1);
    array2 = array2.slice(cutoff2 + 1, array2.length);
    changes += 1;
  }

  if (
    array1[array1.length - 1].start > 8000 &&
    array1[array1.length - 1].confidence < 0.6
  ) {
    array1 = array1.slice(0, -1);
    changes += 1;
  }

  let words1 = [];
  array1.forEach(function (element, i) {
    words1.push(element.text);
  });

  let words2 = [];
  array2.forEach(function (element, i) {
    words2.push(element.text);
  });

  const result = {
    changes,
    previousSeq: {
      text: words1.join(" "),
      words: JSON.stringify(array1),
    },
    currentSeq: {
      text: words2.join(" "),
      words: JSON.stringify(array2),
    },
  };
  return result;
}
