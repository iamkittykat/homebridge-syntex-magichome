let DeviceManager = require('./device-manager');

const SynTexDynamicPlatform = require('homebridge-syntex-dynamic-platform').DynamicPlatform;
const SynTexUniversalAccessory = require('./src/universal');
const lightAgent = require('./src/lib/lightAgent');

const pluginID = 'homebridge-syntex-magichome';
const pluginName = 'SynTexMagicHome';

var homebridge, restart = true;

module.exports = (homebridge) => {

    homebridge.registerPlatform(pluginID, pluginName, SynTexMagicHomePlatform, true);
};

class SynTexMagicHomePlatform extends SynTexDynamicPlatform
{
    constructor(log, config, api)
    {
		super(config, api, pluginID, pluginName);
		
		this.devices = config['accessories'] || [];
		
		if(this.api && this.logger)
        {
            this.api.on('didFinishLaunching', () => {

                DeviceManager = new DeviceManager(this.logger);

				lightAgent.setLogger(this.logger);

				if(homebridge)
				{
					lightAgent.setPersistPath(homebridge.PersistPath);
				}
				
				const { exec } = require('child_process');
						
				exec('sudo chmod 777 -R /usr/local/lib/node_modules/' + pluginID + '/src/flux_led.py', (error, stdout, stderr) => {

					if(error)
					{
						this.logger.log('error', 'bridge', 'Bridge', '[flux_led.py] konnte nicht aktiviert werden!');
					}
				});

                this.initWebServer();

                this.loadAccessories();

                restart = false;
            });
        }
	}

	initWebServer()
	{
		this.WebServer.addPage('/devices', async (response, urlParams) => {

            if(urlParams.id != null)
            {
                var accessory = this.getAccessory(urlParams.id);
    
                if(accessory == null)
                {
                    this.logger.log('error', urlParams.id, '', 'Es wurde kein passendes Gerät in der Config gefunden! ( ' + urlParams.id + ' )');
    
                    response.write('Error');
                }
                else if(urlParams.value != null)
                {
                    var state = { power : urlParams.value };

                    if(urlParams.brightness != null)
                    {
                        state.brightness = urlParams.brightness;
                    }
    
                    if((state = this.validateUpdate(urlParams.id, accessory.service[1].letters, state)) != null)
                    {
                        accessory.service[1].changeHandler(state, true);
                    }
					else
					{
						this.logger.log('error', urlParams.id, accessory.service[1].letters, '[' + urlParams.value + '] ist kein gültiger Wert! ( ' + urlParams.id + ' )');
					}

					response.write(state != null ? 'Success' : 'Error');
				}
				else
				{
					var state = accessory.homebridgeAccessory.context.data[accessory.service[1].letters];

					response.write(state != null ? JSON.stringify(state) : 'Error');
			}
			}
			else
			{
				response.write('Error');
			}

			response.end();
		});

		this.WebServer.addPage('/serverside/version', (response) => {

			response.write(require('../package.json').version);
            response.end();
		});

		this.WebServer.addPage('/serverside/check-restart', (response) => {

			response.write(restart.toString());
            response.end();
		});

		this.WebServer.addPage('/serverside/update', (response, urlParams) => {

			var version = urlParams.version != null ? urlParams.version : 'latest';

			const { exec } = require('child_process');

			exec('sudo npm install ' + pluginID + '@' + version + ' -g', (error, stdout, stderr) => {

				response.write(error || (stderr && stderr.includes('ERR!')) ? 'Error' : 'Success');
				response.end();

                if(error || (stderr && stderr.includes('ERR!')))
                {
                    this.logger.log('warn', 'bridge', 'Bridge', 'Das Plugin ' + pluginName + ' konnte nicht aktualisiert werden! ' + (error || stderr));
                }
                else
                {
                    this.logger.log('success', 'bridge', 'Bridge', 'Das Plugin ' + pluginName + ' wurde auf die Version [' + version + '] aktualisiert!');

                    restart = true;

                    this.logger.log('warn', 'bridge', 'Bridge', 'Die Homebridge wird neu gestartet ..');

                    exec('sudo systemctl restart homebridge');
                }
            });
        });
	}

	loadAccessories()
	{
        for(const device of this.devices)
        {
			const homebridgeAccessory = this.getAccessory(device.id);

			this.addAccessory(new SynTexUniversalAccessory(homebridgeAccessory, device, { platform : this, logger : this.logger, DeviceManager : DeviceManager }));
        }
	}
}