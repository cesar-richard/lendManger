const express = require('express'),
  bodyParser = require('body-parser'),
  Rollbar = require('rollbar'),
  morgan = require('morgan'),
  path = require('path'),
  config = require('./config'),
  routes = require('./app/routes'),
  orm = require('./app/orm'),
  errors = require('./app/middlewares/errors'),
  migrationsManager = require('./migrations'),
  logger = require('./app/logger'),
  DEFAULT_BODY_SIZE_LIMIT = 1024 * 1024 * 10,
  DEFAULT_PARAMETER_LIMIT = 10000;
const session = require('express-session');

const bodyParserJsonConfig = () => ({
  parameterLimit: config.common.api.parameterLimit || DEFAULT_PARAMETER_LIMIT,
  limit: config.common.api.bodySizeLimit || DEFAULT_BODY_SIZE_LIMIT
});

const bodyParserUrlencodedConfig = () => ({
  extended: true,
  parameterLimit: config.common.api.parameterLimit || DEFAULT_PARAMETER_LIMIT,
  limit: config.common.api.bodySizeLimit || DEFAULT_BODY_SIZE_LIMIT
});

const init = () => {
  const app = express();
  const port = config.common.port || 8080;
  module.exports = app;

  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(
    session({
      secret: 'inventoryIsLife!',
      resave: false,
      saveUninitialized: true
    })
  );

  const compassConfig = {
    models: [
      {
        modelName: 'associations',
        attributes: ['id', 'name', 'login', 'active'],
        pKey: ['id'],
        associations: [
          {
            type: 'hasMany',
            model: 'Category',
            attributes: ['id', 'name']
          }
        ]
      }
    ]
  };

  app.locals.title = 'Lend Manager';

  app.use('/docs', express.static(path.join(__dirname, 'docs')));
  app.use(express.static('app/views/public'));

  // Client must send "Content-Type: application/json" header
  app.use(bodyParser.json(bodyParserJsonConfig()));
  app.use(bodyParser.urlencoded(bodyParserUrlencodedConfig()));

  if (!config.isTesting) {
    morgan.token('req-params', req => req.params);
    app.use(
      morgan(
        '[:date[clf]] :remote-addr - Request ":method :url" with params: :req-params. Response status: :status.'
      )
    );
  }

  app.set('view engine', 'pug');
  app.set('views', './app/views');
  app.use(function(req, res, next) {
    res.locals.session = req.session;
    next();
  });

  Promise.resolve()
    .then(() => {
      if (!config.isTesting) {
        return migrationsManager.check();
      }
    })
    .then(() => orm.init(app))
    .then(() =>
      app.use((req, res, next) => {
        require('./app/services/associations')
          .getAll()
          .then(associations => {
            app.locals.associations = associations || [];
            next();
          })
          .catch(next);
      })
    )
    .then(() => {
      routes.init(app);

      app.use(errors.handle);

      const rollbar = new Rollbar({
        accessToken: config.common.rollbar.accessToken,
        enabled: !!config.common.rollbar.accessToken,
        environment: config.common.rollbar.environment || config.environment
      });
      app.use(rollbar.errorHandler());

      app.listen(port);

      logger.info(`Listening on port: ${port}`);
    })
    .catch(logger.error);
};
init();
