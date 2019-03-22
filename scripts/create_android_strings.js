var fs = require('fs-extra');
var path = require('path');
var _has = require('lodash.has');
var _forEach = require('lodash.foreach');
var _assignIn = require('lodash.assignin');
var xml2js = require('xml2js');
var q = require('q');
var glob = require('glob');

function fileExists(path) {
  try {
    return fs.statSync(path).isFile();
  } catch (e) {
    return false;
  }
}

module.exports = function (context) {
  var deferred = q.defer();

  getTargetLang(context).then(function (languages) {
    var promisesToRun = [];

    languages.forEach(function (lang) {
      //read the json file
      var langJson = require(lang.path);

      // check the locales to write to
      var localeLangs = [];
      if (_has(langJson, 'locale') && _has(langJson.locale, 'android')) {
        //iterate the locales to to be iterated.
        _forEach(langJson.locale.android, function (aLocale) {
          localeLangs.push(aLocale);
        });
      } else {
        // use the default lang from the filename, for example "en" in en.json
        localeLangs.push(lang.lang);
      }

      _forEach(localeLangs, function (localeLang) {
        var stringXmlFilePath = getLocalStringXmlPath(context, localeLang);
        var parser = new xml2js.Parser();

        var stringXmlJson;
        if (!fileExists(stringXmlFilePath)) {
          stringXmlJson = {
            'resources': {
              'string': [],
            },
          };
          promisesToRun.push(processResult(context, localeLang, langJson, stringXmlJson));
        } else {
          //lets read from strings.xml into json
          fs.readFile(stringXmlFilePath, { encoding: 'utf8' }, function (err, data) {
            if (err) {
              throw err;
            }

            parser.parseString(data, function (err, result) {
              if (err) {
                throw err;
              }

              stringXmlJson = result;

              // initialize xmlJson to have strings
              if (!_has(stringXmlJson, 'resources') || !_has(stringXmlJson.resources, 'string')) {
                stringXmlJson.resources = {
                  'string': [],
                };
              }

              promisesToRun.push(processResult(context, localeLang, langJson, stringXmlJson));
            });
          });
        }
      });
    });

    return q.all(promisesToRun).then(function () {
      deferred.resolve();
    });
  }).catch(function (err) {
    deferred.reject(err);
  });

  return deferred.promise;
};

function getTargetLang(context) {
  var targetLangArr = [];
  var deferred = q.defer();

  glob('translations/app/*.json', function (err, langFiles) {
    if (err) {
      deferred.reject(err);
    } else {
      langFiles.forEach(function (langFile) {
        var matches = langFile.match(/translations\/app\/(.*).json/);

        if (matches) {
          targetLangArr.push({
            lang: matches[1],
            path: path.join(context.opts.projectRoot, langFile),
          });
        }
      });
      deferred.resolve(targetLangArr);
    }
  });

  return deferred.promise;
}

/* eslint-disable */
function getLocalizationDir(context, lang) {
  var langDir;
  switch (lang) {
    case 'en':
      langDir = path.normalize(path.join(getResPath(context), 'values'));
      break;
    default:
      langDir = path.normalize(path.join(getResPath(context), 'values-' + lang));
      break;
  }
  return langDir;
}

function getLocalStringXmlPath(context, lang) {
  var filePath;
  switch (lang) {
    case 'en':
      filePath = path.normalize(path.join(getResPath(context), 'values/strings.xml'));
      break;
    default:
      filePath = path.normalize(path.join(getResPath(context), 'values-' + lang + '/', 'strings.xml'));
      break;
  }
  return filePath;
}
/* eslint-enable */

function getResPath(context) {
  var locations = context.requireCordovaModule('cordova-lib/src/platforms/platforms').getPlatformApi('android').locations;

  if (locations && locations.res) {
    return locations.res;
  }

  return path.join(context.opts.projectRoot, 'platforms/android/res');
}

// process the modified xml and put write to file
function processResult(context, lang, langJson, stringXmlJson) {
  var deferred = q.defer();

  var mapObj = {};
  // create a map to the actual string
  _forEach(stringXmlJson.resources.string, function (val) {
    if (_has(val, '$') && _has(val['$'], 'name')) {
      mapObj[val['$'].name] = val;
    }
  });

  var langJsonToProcess = _assignIn(langJson.config_android, langJson.app);

  // now iterate through langJsonToProcess
  _forEach(langJsonToProcess, function (val, key) {
    // positional string format is in Mac OS X format.  change to android format
    let cleanVal = val.replace(/\$@/gi, '$s');

    if (_has(mapObj, key)) {
      // mapObj contains key. replace key
      mapObj[key]['_'] = cleanVal;
    } else {
      // add by inserting
      stringXmlJson.resources.string.push({
        _: cleanVal,
        '$': { name: key },
      });
    }
  });

  //save to disk
  var langDir = getLocalizationDir(context, lang);
  var filePath = getLocalStringXmlPath(context, lang);

  fs.ensureDir(langDir, function (err) {
    if (err) {
      throw err;
    }

    fs.writeFile(filePath, buildXML(stringXmlJson), { encoding: 'utf8' }, function (err) {
      if (err) throw err;
      console.log('Localization file saved: ' + filePath); // eslint-disable-line no-console
      return deferred.resolve();
    });
  });

  function buildXML(obj) {
    var builder = new xml2js.Builder();
    builder.options.renderOpts.indent = '\t';

    var x = builder.buildObject(obj);
    return x.toString();
  }

  return deferred.promise;
}
