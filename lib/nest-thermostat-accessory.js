/**
 * Created by kraigm on 12/15/15.
 */

var inherits = require('util').inherits;
var Accessory, Service, Characteristic, Away, uuid;

'use strict';

module.exports = function(exportedTypes) {
	if (exportedTypes && !Accessory) {
		Accessory = exportedTypes.Accessory;
		Service = exportedTypes.Service;
		Characteristic = exportedTypes.Characteristic;
		uuid = exportedTypes.uuid;
		Away = exportedTypes.Away;

		var acc = NestThermostatAccessory.prototype;
		inherits(NestThermostatAccessory, Accessory);
		NestThermostatAccessory.prototype.parent = Accessory.prototype;
		for (var mn in acc) {
			NestThermostatAccessory.prototype[mn] = acc[mn];
		}
	}
	return NestThermostatAccessory;
};

function NestThermostatAccessory(conn, log, device, structure) {

	// device info
	this.conn = conn;
	this.name = device.name;
	this.deviceId = device.device_id;
	this.log = log;
	this.device = device;
	this.structure = structure;
	this.structureId = structure.structure_id;

	var id = uuid.generate('nest.thermostat.' + this.deviceId);
	Accessory.call(this, this.name, id);
	this.uuid_base = id;

	this.getService(Service.AccessoryInformation)
		.setCharacteristic(Characteristic.Manufacturer, "Nest");

	var thermostatService = this.addService(Service.Thermostat);

	var formatAsDisplayTemperature = function(t) {
		return this.usesFahrenheit() ? celsiusToFahrenheit(t) + " F" : t + " C";
	}.bind(this);

	var formatHeatingCoolingState = function (val) {
		switch (val) {
			case Characteristic.CurrentHeatingCoolingState.OFF:
				return "Off";
			case Characteristic.CurrentHeatingCoolingState.HEAT:
				return "Heating";
			case Characteristic.CurrentHeatingCoolingState.COOL:
				return "Cooling";
			case Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL:
				return "Heating/Cooling";
		}
	};

	this.boundCharacteristics = [];
	var bindCharacteristic = function (characteristic, desc, getFunc, setFunc, format) {
		var actual = thermostatService.getCharacteristic(characteristic)
			.on('get', function (callback) {
				var val = getFunc.bind(this)();
				if (callback) callback(null, val);
			}.bind(this))
			.on('change', function (change) {
				var disp = change.newValue;
				if (format && disp != null) {
					disp = format(disp);
				}
				this.log(desc + " for " + this.name + " is: " + disp);
			}.bind(this));
		if (setFunc) {
			actual.on('set', setFunc.bind(this));
		}
		this.boundCharacteristics.push(characteristic);
	}.bind(this);

	bindCharacteristic(Characteristic.TemperatureDisplayUnits, "Temperature unit", this.getTemperatureUnits, null, function (val) {
		return val == Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? "Fahrenheit" : "Celsius";
	});

	bindCharacteristic(Characteristic.CurrentTemperature, "Current temperature", this.getCurrentTemperature, null, formatAsDisplayTemperature);
	bindCharacteristic(Characteristic.CurrentHeatingCoolingState, "Current heating", this.getCurrentHeatingCooling, null, formatHeatingCoolingState);
	bindCharacteristic(Characteristic.CurrentRelativeHumidity, "Current humidity", this.getCurrentRelativeHumidity, null, function(val) {
		return val + "%";
	});

	bindCharacteristic(Characteristic.TargetTemperature, "Target temperature", this.getTargetTemperature, this.setTargetTemperature, formatAsDisplayTemperature);
	bindCharacteristic(Characteristic.TargetHeatingCoolingState, "Target heating", this.getTargetHeatingCooling, this.setTargetHeatingCooling, formatHeatingCoolingState);

	thermostatService.addCharacteristic(Away);
	bindCharacteristic(Away, "Away", this.isAway, this.setAway);

	this.updateData();
}

NestThermostatAccessory.prototype.getServices = function () {
	return this.services;
};

NestThermostatAccessory.prototype.updateData = function (device, structure) {
	if (device) {
		this.device = device;
	}
	if (structure) {
		this.structure = structure;
	}
	var thermostat = this.getService(Service.Thermostat);
	this.boundCharacteristics.map(function (c) {
		thermostat.getCharacteristic(c).getValue();
	});
};

NestThermostatAccessory.prototype.getCurrentHeatingCooling = function () {
	switch (this.device.hvac_state) {
		case "off":
			return Characteristic.CurrentHeatingCoolingState.OFF;
		case "heating":
			return Characteristic.CurrentHeatingCoolingState.HEAT;
		case "cooling":
			return Characteristic.CurrentHeatingCoolingState.COOL;
		default:
			return Characteristic.CurrentHeatingCoolingState.OFF;
	}
};

NestThermostatAccessory.prototype.getTargetHeatingCooling = function () {
	switch (this.device.hvac_mode) {
		case "off":
			return Characteristic.CurrentHeatingCoolingState.OFF;
		case "heat":
			return Characteristic.CurrentHeatingCoolingState.HEAT;
		case "cool":
			return Characteristic.CurrentHeatingCoolingState.COOL;
		case "heat-cool":
			return Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL;
		default:
			return Characteristic.CurrentHeatingCoolingState.OFF;
	}
};

NestThermostatAccessory.prototype.isAway = function () {
	switch (this.structure.away) {
		case "home":
			return false;
		case "away":
		case "auto-away":
			return true;
		default:
			return false;
	}
};

NestThermostatAccessory.prototype.getCurrentTemperature = function () {
	if (this.usesFahrenheit()) {
		return fahrenheitToCelsius(this.device.ambient_temperature_f);
	} else {
		return this.device.ambient_temperature_c;
	}
};

NestThermostatAccessory.prototype.getCurrentRelativeHumidity = function () {
	return this.device.humidity;
};

NestThermostatAccessory.prototype.getTargetTemperature = function () {
	switch (this.getTargetHeatingCooling()) {
		case Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL:
			// Choose closest target as single target
			var high, low;
			if (this.usesFahrenheit()) {
				high = fahrenheitToCelsius(this.device.target_temperature_high_f);
				low = fahrenheitToCelsius(this.device.target_temperature_low_f);
			} else {
				high = this.device.target_temperature_high_c;
				low = this.device.target_temperature_low_c;
			}
			var cur = this.getCurrentTemperature();
			return Math.abs(high - cur) < Math.abs(cur - low) ? high : low;
		default:
			if (this.usesFahrenheit()) {
				return fahrenheitToCelsius(this.device.target_temperature_f);
			} else {
				return this.device.target_temperature_c;
			}
	}
};

NestThermostatAccessory.prototype.getTemperatureUnits = function () {
	switch (this.device.temperature_scale) {
		case "F":
			return Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
		case "C":
			return Characteristic.TemperatureDisplayUnits.CELSIUS;
		default:
			return Characteristic.TemperatureDisplayUnits.CELSIUS;
	}
};

var getThermostatPath = function(deviceId, property) {
	return 'devices/thermostats/' + deviceId + '/' + property;
};

var getStructurePath = function(deviceId, property) {
	return 'structures/' + deviceId + '/' + property;
};

var callbackPromise = function(promise, callback, val) {
	promise
		.then(function () {
			callback(null, val);
		})
		.catch(function (err) {
			callback(err);
		});
};

function fahrenheitToCelsius(temperature) {
	return (temperature - 32) / 1.8;
}

function celsiusToFahrenheit(temperature) {
	return (temperature * 1.8) + 32;
}

NestThermostatAccessory.prototype.setTargetHeatingCooling = function (targetHeatingCooling, callback) {
	var val = null;

	switch (targetHeatingCooling) {
		case Characteristic.CurrentHeatingCoolingState.HEAT:
			val = 'heat';
			break;
		case Characteristic.CurrentHeatingCoolingState.COOL:
			val = 'cool';
			break;
		case Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL:
			val = 'heat-cool';
			break;
		default:
			val = 'off';
			break;
	}

	this.log("Setting target heating cooling for " + this.name + " to: " + val);
	var promise = this.conn.update(getThermostatPath(this.deviceId, "hvac_mode"), val);

	if (callback) callbackPromise(promise, callback, val);
	else return promise;
};

NestThermostatAccessory.prototype.setTargetTemperature = function (targetTemperature, callback) {
	var promise;

	var usesFahrenheit = this.usesFahrenheit();
	if (usesFahrenheit) {
		// Convert to Fahrenheit and round to nearest integer
		targetTemperature = Math.round(celsiusToFahrenheit(targetTemperature));
	} else {
		// Celsius value has to be in half point increments
		targetTemperature = Math.round( targetTemperature * 2 ) / 2;
	}

	var key = "target_temperature_";
	var prop = "";
	if (this.getTargetHeatingCooling() == (Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL)) {
		// Choose closest target as single target
		var high, low;
		if (usesFahrenheit) {
			high = fahrenheitToCelsius(this.device.target_temperature_high_f);
			low = fahrenheitToCelsius(this.device.target_temperature_low_f);
		} else {
			high = this.device.target_temperature_high_c;
			low = this.device.target_temperature_low_c;
		}
		var cur = this.getCurrentTemperature();
		var isHighTemp = Math.abs(high - cur) < Math.abs(cur - low);
		prop = isHighTemp ? "high" : "low";
		key += prop + "_";
		prop += " ";
	}

	key += (usesFahrenheit ? "f" : "c");

	this.log("Setting " + prop + "target temperature for " + this.name + " to: " + targetTemperature);
	promise = this.conn.update(getThermostatPath(this.deviceId, key), targetTemperature);

	if (callback) callbackPromise(promise, callback, targetTemperature);
	else return promise;
};

NestThermostatAccessory.prototype.setAway = function (away, callback) {
	var val = away ? 'away' : 'home';
	this.log("Setting Away for " + this.name + " to: " + val);
	var promise = this.conn.update(getStructurePath(this.structureId, "away"), val);

	if (callback) callbackPromise(promise, callback, away);
	else return promise;
};

NestThermostatAccessory.prototype.usesFahrenheit = function () {
	return this.getTemperatureUnits() == Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
};
