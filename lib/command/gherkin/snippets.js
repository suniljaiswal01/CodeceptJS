const getConfig = require('../utils').getConfig;
const getTestRoot = require('../utils').getTestRoot;
const Codecept = require('../../codecept');
const container = require('../../container');
const output = require('../../output');
const { matchStep } = require('../../interfaces/bdd');
const { Parser } = require('gherkin');
const glob = require('glob');
const fsPath = require('path');
const fs = require('fs');

const parser = new Parser();
parser.stopAtFirstError = false;


module.exports = function (genPath, options) {
  const configFile = options.config || genPath;
  const testsPath = getTestRoot(configFile);
  const config = getConfig(configFile);
  if (!config) return;

  const codecept = new Codecept(config, {});
  codecept.init(testsPath, (err) => {
    if (!config.gherkin) {
      output.error('Gherkin is not enabled in config. Run `codecept gherkin:init` to enable it');
      process.exit(1);
    }
    if (!config.gherkin.steps || !config.gherkin.steps[0]) {
      output.error('No gherkin steps defined in config. Exiting');
      process.exit(1);
    }
    if (!config.gherkin.features) {
      output.error('No gherkin features defined in config. Exiting');
      process.exit(1);
    }

    const files = [];
    glob.sync(config.gherkin.features, { cwd: global.codecept_dir }).forEach((file) => {
      if (!fsPath.isAbsolute(file)) {
        file = fsPath.join(global.codecept_dir, file);
      }
      files.push(fsPath.resolve(file));
    });
    output.print(`Loaded ${files.length} files`);

    let newSteps = [];

    const parseSteps = (steps) => {
      const newSteps = [];
      let currentKeyword = '';
      for (const step of steps) {
        if (step.keyword.trim() === 'And') {
          if (!currentKeyword) throw new Error(`There is no active keyword for step '${step.text}'`);
          step.keyword = currentKeyword;
        }
        currentKeyword = step.keyword;
        try {
          matchStep(step.text);
        } catch (err) {
          let stepLine = step.text
            .replace(/\"(.*?)\"/g, '{string}')
            .replace(/(\d+\.\d+)/, '{float}')
            .replace(/ (\d+) /, ' {int} ');
          stepLine = Object.assign(stepLine, { type: step.keyword.trim(), location: step.location });
          newSteps.push(stepLine);
        }
      }
      return newSteps;
    };

    const parseFile = (file) => {
      const ast = parser.parse(fs.readFileSync(file).toString());
      for (const child of ast.feature.children) {
        if (child.type === 'ScenarioOutline') continue; // skip scenario outline
        newSteps = newSteps.concat(parseSteps(child.steps).map((step) => {
          return Object.assign(step, { file: file.replace(global.codecept_dir, '').slice(1) });
        }));
      }
    };

    files.forEach(file => parseFile(file));

    let stepFile = config.gherkin.steps[0];
    if (!fsPath.isAbsolute(stepFile)) {
      stepFile = fsPath.join(global.codecept_dir, stepFile);
    }

    const snippets = newSteps
      .filter((value, index, self) => self.indexOf(value) === index)
      .map((step) => {
        return `
${step.type}('${step}', () => {
  // From "${step.file}" ${JSON.stringify(step.location)}
  throw new Error('Not implemented yet');
});`;
      });

    if (!snippets.length) {
      output.print('No new snippets found');
      return;
    }
    output.success(`Snippets generated: ${snippets.length}`);
    output.print(snippets.join('\n'));

    if (!options.dryRun) {
      output.success(`Snippets added to ${output.colors.bold(stepFile)}`);
      fs.writeFileSync(stepFile, fs.readFileSync(stepFile).toString() + snippets.join('\n') + '\n'); // eslint-disable-line
    }
  });
};