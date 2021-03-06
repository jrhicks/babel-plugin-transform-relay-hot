/**
 * Returns a new Babel Transformer that uses the supplied schema to transform
 * template strings tagged with `Relay.QL` into an internal representation of
 * GraphQL queries.
 */

const getBabelRelayPlugin = require('babel-relay-plugin');
const fs = require('fs');


// file changes watcher
function watcherFn(schemaJsonFilepath, watchInterval, reinitBabelRelayPlugin, prevMtime) {
  try {
    const stats = fs.statSync(schemaJsonFilepath);
    if (stats) {
      if (!prevMtime) prevMtime = stats.mtime;
      if (stats.mtime.getTime() !== prevMtime.getTime()) {
        prevMtime = stats.mtime;
        reinitBabelRelayPlugin();
      }
    }
    setTimeout(
      () => {
        watcherFn(schemaJsonFilepath, watchInterval, reinitBabelRelayPlugin, prevMtime);
      },
      watchInterval
    ).unref(); // fs.watch blocks babel from exit, so using `setTimeout` with `unref`
  } catch (e) {
    console.error('[transform-relay-hot] ' + e);
  }
}


// babelRelayPlugin initializer
function initBabelRelayPlugin(pluginOptions, babel, ref) {
  const verbose = !!pluginOptions.verbose;
  const schemaJsonFilepath = pluginOptions.schemaJsonFilepath || '';
  let schema;

  try {
    schema = JSON.parse(fs.readFileSync(schemaJsonFilepath, 'utf8'));
  } catch (e) {
    schema = null;
    console.error('[transform-relay-hot] Cannot load GraphQL Schema from file \''
                 + schemaJsonFilepath + '\': ' + e);
  }

  if (schema && schema.data) {
    if (verbose) {
      console.log('[transform-relay-hot] GraphQL Schema loaded successfully from \''
                   + schemaJsonFilepath + '\'');
    }
    ref.babelRelayPlugin = getBabelRelayPlugin(schema.data, pluginOptions)(babel);
  } else {
    // empty Plugin
    console.error('[transform-relay-hot] Relay.QL will not be transformed, cause `schema.data` is empty.');
    ref.babelRelayPlugin = {
      visitor: {
        Program: function () {},
        TaggedTemplateExpression: function () {},
      },
    };
  }
}


// babel plugin proxy
module.exports = function (babel) {
  let ref;
  return {
    visitor: {
      /**
       * Extract the module name from `@providesModule`.
       */
      Program(path, state) {
        // HACK ONLY ONCE obtain plugin configs form .babelrc and init BabelRelayPlugin
        if (!ref) {
          ref = {};
          const pluginOptions = state.opts || {};
          if (!pluginOptions.schemaJsonFilepath || pluginOptions.schemaJsonFilepath === '') {
            console.error(
              '[transform-relay-hot] You should provide `schemaJsonFilepath` option in .babelrc:'
              + '\n   {'
              + '\n     "plugins": ['
              + '\n       ["transform-relay-hot", {'
              + '\n         "schemaJsonFilepath": "./pathToSchema.json",'
              + '\n         "watchInterval": 2000'
              + '\n       }]'
              + '\n     ]'
              + '\n   }'
           );
          }

          // HACK obtain/update babelRelayPlugin by reference
          initBabelRelayPlugin(pluginOptions, babel, ref);

          const watchInterval = pluginOptions && pluginOptions.watchInterval
            ? pluginOptions.watchInterval
            : 2000;
          if (watchInterval > 0 && pluginOptions.schemaJsonFilepath) {
            const reinitBabelRelayPlugin = () => {
              initBabelRelayPlugin(pluginOptions, babel, ref);
            };
            watcherFn(pluginOptions.schemaJsonFilepath, watchInterval, reinitBabelRelayPlugin);
          }
        }

        ref.babelRelayPlugin.visitor.Program(path, state);
      },

      /**
       * Transform Relay.QL`...`.
       */
      TaggedTemplateExpression(path, state) {
        ref.babelRelayPlugin.visitor.TaggedTemplateExpression(path, state);
      },
    },
  };
};
