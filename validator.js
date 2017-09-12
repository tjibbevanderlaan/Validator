// Validator.js - v3.4
//
// JSON Schema Validator for API w/ a middleware for express
// Developed by Nijiko Yonskai <nijikokun@gmail.com>
// Forked by Phil Douglas https://github.com/ricick/Validator
// Forked by Tjibbe van der Laan https://github.com/tjibbevanderlaan/Validator
// Copyright 2013-2017
var Validator = function(schema, middleware) {
  this.schema = schema
  this.parameters = Object.keys(this.schema)
  this.errors = {}
  this.retrieved = {}
  this.debug = false

  if (middleware) {
    return this.middleware()
  }
};

// Plugin Containers
Validator.plugins = {}
Validator.plugins._objects = []

// Extend validator field possibilities
Validator.implement = function(field, isObject, callback) {
  if (typeof isObject === 'function') {
    callback = isObject
    isObject = false
  }

  if (isObject) {
    Validator.plugins._objects.push(field)
  }

  Validator.plugins[field] = function(details, key, data) {
    var $this = this
    var option = {
      details: details,
      field: field,
      value: details[field],
      key: key,
      data: data,
      error: function(type, message) {
        if (typeof message === 'undefined') {
          message = type
          type = undefined
        }

        $this.error(key, (type || field), message, option)
        return $this.errors
      }
    }

    callback.call(this, option)
    return this.checkErrors()
  }
}

// Validator Initialization Methods
Validator.prototype.middleware = function() {
  var self = this

  return function(req, res, next) {
    req.validated = self.check(req)

    if (req.validated._error) {
      return res.send(500, req.validated)
    }

    next()
  }
}

// Initializes validation against an object
Validator.prototype.check = function(against) {
  this.against = against
  return this.validate()
}

// Parameter Check
//
// Retrieves data from either an express method, or explicitly given object.
Validator.prototype.param = function(key) {
  if (this.against.param) {
    return this.against.param(key)
  }

  return this.against[key]
}

// Validation
Validator.prototype.validate = function() {

  // Loop over all items within the schema
  for (var item in this.schema) {
    if (this.loop(item)) {
      return this.errors;
    }
  }

  // If no errors are found, return retrieved data
  return this.retrieved
}

// Error Management
Validator.prototype.error = function(key, type, message, option) {
  this.errors._error = this.errors._error || true
  this.errors[key] = this.errors[key] || {}
  this.errors[key][type] = {
    message: message
  }

  if (option && this.debug && typeof option.data !== "undefined") {
    this.errors[key][type].value = typeof option.data === 'object' ? JSON.stringify(option.data) : option.data
  }
}

// Check length of error object
Validator.prototype.checkErrors = function() {
  return (Object.keys(this.errors).length > 0)
}


// Validation Looper
//
Validator.prototype.loop = function(keychain) {
  var details = prop(this.schema);
  var fields = [];
  for (var field in details) {
    fields.push(field.toLowerCase());
  }
  var data = prop(this.against);
  var nodata = (data === undefined || data === null);

  // Sort the required field to the top
  // This field is of primary importance
  fields.sort(function(a, b) {
    return (a === 'required') ? 0 : 1;
  });


  // If no data could be found, substitute the data
  // with the default attributes (if given by the
  // schema)
  if (nodata && details["default"]) {
    data = details["default"];
    append(this.against, data);
    nodata = (data === undefined || data === null);
  }

  // Loop over the fields
  for (var f = 0; f < fields.length; f++) {
    var field = fields[f];

    // Is the object required and not there? Skip object and its childs
    if (field === "required" && nodata) {
      if (details["required"] === true) {
        return this.error(keychain, "required", "This parameter is required.");
      } else {
        break;
      }

      // Do we have a validator plugin set for this field?
    } else if (Validator.plugins[field]) {
      if (Validator.plugins[field].call(this, details, keychain, data)) {
        return this.errors
      }

      // Is the field a sub-object? Trigger looper for the sub-object
    } else if (Object.prototype.toString.call(prop(this.schema)[field]) == "[object Object]") {
      var subkeychain = keychain + "." + field;

      if (this.loop(subkeychain)) {
        return this.errors
      }
    }
  }

  // If no errors found in this loop, a.k.a. for this keychain, append
  // the data (if there is data) (if it is no sub-object!) to the 'valid-data-object'
  if (!nodata && Object.prototype.toString.call(data) !== "[object Object]") {
    append(this.retrieved, data);
  }

  // Helper function to retrieve deep-nested objects and items
  function prop(object) {
    var obj = object;
    var arr = keychain.split(".");
    if (!arr[0].length) return obj; // if keychain is empty, return complete obj
    while (arr.length && (obj = obj[arr.shift()]));

    return obj;
  }

  // Helper function to append items to deep-nested objects
  function append(object, value) {
    var obj = object;
    var keylist = keychain.split(".");
    for (var k = 0; k < keylist.length; k++) {
      var key = keylist[k];
      if (k === keylist.length - 1) {
        obj[key] = value;
      } else if (!obj[key]) {
        obj[key] = {};
      }
      obj = obj[key];
    }

    return object;
  }
}


// Validator Implementation
//
// Field: `type`
//
// Checks whether value is function to support using native words.
// Checks against `Object.prototype.toString.call` for exact type rather than `typeof`.
// By doing so it requires that the field starts with a capitol letter such as: `String`.
Validator.implement("type", function(options) {
  if (typeof options.value === 'function') {
    options.value = options.value.name
  }
  if (Object.prototype.toString.call(options.data) !== "[object " + options.value + "]") {
    options.error("Invalid parameter data type, expected: " + options.value);
  }
});

// Validator Implementation
//
// Field: `length`
//
// Supports: `Number` or `Object` with `min` and `max` values.
//
// Checks given data length against a numerical value, when the field is an object we check against
// the `min` and `max` values. If the field is simply a numeric value we check for equality.
Validator.implement("length", true, function(options) {
  if (typeof options.data === "undefined") {
    return;
  }

  // Check whether length exists, otherwise use value
  options.against = options.data.length ? options.data.length : options.data;

  // Checks
  if (typeof options.value === "object") {
    if (options.value.min) {
      if (options.value.min > options.against) {
        options.error("min", "Must be greater than " +
          options.value.min + (options.data.type === "string" ? " characters long." : ""))
      }
    }

    if (options.value.max) {
      if (options.value.max < options.against) {
        options.error("max", "Must be less than " +
          options.value.max + (options.data.type === "string" ? " characters long." : ""))
      }
    }
  } else if (typeof options.value === "number") {
    if (options.value != options.against) {
      options.error("Must be " + options.value + " characters long.")
    }
  }
});

// Validator Implementation
//
// Field: `test`
//
// Supports: `RegExp` or `Array` of `RegExp`
//
// Checks given data against a single `RegExp` using `.test` or an `Array` of `RegExp` using `.test`
Validator.implement("test", function(options) {
  if (Object.prototype.toString.call(options.value) === "[object Array]") {
    var i = 0
    var regex

    for (i; i < options.value.length; i++) {
      if (!options.value[i].test(options.data.toString())) {
        options.error("test-" + i, "Parameter data did not pass regex test.")
      }
    }
  } else {
    if (!options.value.test(options.data)) {
      options.error("Parameter data did not pass regex test.")
    }
  }
})

// Export our module
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = Validator
} else {
  if (typeof define === 'function' && define.amd) define([], function() { return Validator })
  else window.Validator = Validator;
}