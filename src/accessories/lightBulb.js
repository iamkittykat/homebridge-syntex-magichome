const convert = require('color-convert');
const Accessory = require('./base');

var logger = null, DeviceManager = null;

const LightBulb = class extends Accessory
{
	constructor(config, log, homebridge, manager)
	{
		super(config, log, homebridge, manager);

		logger = log;
		DeviceManager = manager;

		this.name = config.name || 'LED Controller';
		this.ip = config.ip;
		this.setup = config.setup || 'RGBW';
		this.color = { H: 0, S: 0, L: 100 };
		this.purewhite = config.purewhite || false;
		this.timeout = config.timeout != null ? config.timeout : 60000;

		this.letters = '30';

		DeviceManager.getDevice(this.mac, this.letters).then(function(state) {

			if(state == null)
			{
				logger.log('error', this.mac, this.letters, '[' + this.name + '] wurde nicht in der Storage gefunden! ( ' + this.mac + ' )');
			}
			else if((state = validateUpdate(this.mac, this.letters, state)) != null)
			{
				logger.log('read', this.mac, this.letters, 'HomeKit Status für [' + this.name + '] ist [' + state + '] ( ' + this.mac + ' )');

				this.isOn = state.split(':')[0];
				this.color = {
					H : state.split(':')[1],
					S : state.split(':')[2],
					L : state.split(':')[3]
				};

				this.services[0].getCharacteristic(this.homebridge.Characteristic.On).updateValue(this.isOn);
				this.services[0].getCharacteristic(this.homebridge.Characteristic.Hue).updateValue(this.color.H);
				this.services[0].getCharacteristic(this.homebridge.Characteristic.Saturation).updateValue(this.color.S);
				this.services[0].getCharacteristic(this.homebridge.Characteristic.Brightness).updateValue(this.color.L);
			}

		}.bind(this));
		
		setTimeout(() => {

			this.updateState();

		}, 3000);

		this.changeHandler = (function(state)
		{
			var temp = this.isOn;
			
			var power = state.split(':')[0];
			var hue = state.split(':')[1];
			var saturation = state.split(':')[2];
			var brightness = state.split(':')[3];
			
			this.color = { H: hue, S: saturation, L: brightness };

			this.setPowerState(power == 'true' ? true : false, () => setTimeout(() => this.setToCurrentColor(), temp ? 0 : 1000));

		}.bind(this));
	}

	getAccessoryServices()
	{
		var lightbulbService = new this.homebridge.Service.Lightbulb(this.name);

		lightbulbService.getCharacteristic(this.homebridge.Characteristic.On)
			.on('get', this.getPowerState.bind(this))
			.on('set', this.setPowerState.bind(this));

		lightbulbService.addCharacteristic(new this.homebridge.Characteristic.Hue())
			.on('get', this.getHue.bind(this))
			.on('set', this.setHue.bind(this));

		lightbulbService.addCharacteristic(new this.homebridge.Characteristic.Saturation())
			.on('get', this.getSaturation.bind(this))
			.on('set', this.setSaturation.bind(this));

		lightbulbService.addCharacteristic(new this.homebridge.Characteristic.Brightness())
			.on('get', this.getBrightness.bind(this))
			.on('set', this.setBrightness.bind(this));

		return [lightbulbService];
	}

	sendCommand(command, callback)
	{
		this.executeCommand(this.ip, command, callback);
	}

	getModelName()
	{
		return 'Light Bulb';
	}

	getSerialNumber()
	{
		return '00-001-LightBulb';
	}

	logMessage(...args)
	{
		if(this.config.debug)
		{
			logger.debug(args);
		}
	}

	startTimer()
	{
		if (this.timeout === 0) return;

		setTimeout(() => {

			this.updateState();

		}, this.timeout);
	}

	updateState()
	{
		const self = this;

		this.logMessage('Polling Light', this.ip);

		self.getState((settings) => {

			self.isOn = settings.on;
			self.color = settings.color;

			self.logMessage('Updating Device', self.ip, self.color, self.isOn);

			self.services[0].getCharacteristic(this.homebridge.Characteristic.On).updateValue(self.isOn);
			self.services[0].getCharacteristic(this.homebridge.Characteristic.Hue).updateValue(self.color.H);
			self.services[0].getCharacteristic(this.homebridge.Characteristic.Saturation).updateValue(self.color.S);
			self.services[0].getCharacteristic(this.homebridge.Characteristic.Brightness).updateValue(self.color.L);

			this.startTimer();
		});
	}

	getState(callback)
	{
		this.sendCommand('-i', (error, stdout) => {

			var settings = {
				on: false,
				color: { H: 255, S: 100, L: 50 }
			};

			var colors = stdout.match(/\(.*,.*,.*\)/g);
			var isOn = stdout.match(/\] ON /g);

			if(isOn && isOn.length > 0)
			{
				settings.on = true;
			}

			if(colors && colors.length > 0)
			{
				// Remove last char )
				var str = colors.toString().substring(0, colors.toString().length - 1);
				// Remove First Char (
				str = str.substring(1, str.length);

				const rgbColors = str.split(',').map((item) => {

					return item.trim()
				});

				var converted = convert.rgb.hsv(rgbColors);

				settings.color = {
					H: converted[0],
					S: converted[1],
					L: converted[2]
				};
			}

			callback(settings);
		})
	}

	getPowerState(callback)
	{
		callback(null, this.isOn);
	}

	setPowerState(value, callback)
	{
		const self = this;

		this.sendCommand(value ? '--on' : '--off', () => {

			self.isOn = value;

			logger.log('update', self.mac, self.name, 'HomeKit Status für [' + self.name + '] geändert zu [' + self.isOn + ':' + self.color.H + ':' + self.color.S + ':' + self.color.L + '] ( ' + self.mac + ' )');

			DeviceManager.setDevice(self.mac, self.letters, self.isOn + ':' + self.color.H + ':' + self.color.S + ':' + self.color.L);

			callback();
		});
	}

	getHue(callback)
	{
		callback(null, this.color.H);
	}

	setHue(value, callback)
	{
		this.color.H = value;

		if(!this.isOn)
		{
			this.setPowerState(true, () => setTimeout(() => this.setToCurrentColor(), 1000));
		}
		else
		{
			this.setToCurrentColor();
		}

		callback();
	}

	getBrightness(callback)
	{
		callback(null, this.color.L);
	}

	setBrightness(value, callback)
	{
		this.color.L = value;
		
		if(!this.isOn)
		{
			this.setPowerState(true, () => setTimeout(() => this.setToCurrentColor(), 1000));
		}
		else
		{
			this.setToCurrentColor();
		}

		callback();
	}

	getSaturation(callback)
	{
		callback(null, this.color.S);
	}

	setSaturation(value, callback)
	{
		this.color.S = value;
		
		if(!this.isOn)
		{
			this.setPowerState(true, () => setTimeout(() => this.setToCurrentColor(), 1000));
		}
		else
		{
			this.setToCurrentColor();
		}

		callback();
	}

	setToWarmWhite()
	{
		this.sendCommand('-w ' + this.color.L);
	}

	setToCurrentColor()
	{
		var color = this.color;

		if(color.S === 0 && color.H === 0 && this.purewhite)
		{
			this.setToWarmWhite();
			return;
		}

		var converted = convert.hsv.rgb([color.H, color.S, color.L]);
		//logger.log('update', 'bridge', 'Bridge', 'Setting New Color Of ' + this.ip + ' To ' + converted);
		logger.log('update', this.mac, this.name, 'HomeKit Status für [' + this.name + '] geändert zu [' + this.isOn + ':' + this.color.H + ':' + this.color.S + ':' + this.color.L + '] ( ' + this.mac + ' )');

		var base = '-x ' + this.setup + ' -c ';
		this.sendCommand(base + converted[0] + ',' + converted[1] + ',' + converted[2]);

		DeviceManager.setDevice(this.mac, this.letters, this.isOn + ':' + this.color.H + ':' + this.color.S + ':' + this.color.L);
	}
}

module.exports = LightBulb;