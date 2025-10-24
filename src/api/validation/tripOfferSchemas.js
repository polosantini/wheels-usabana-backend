const Joi = require('joi');

/**
 * Validation schemas for Trip Offer endpoints
 */

// Schema for geo location
const geoLocationSchema = Joi.object({
  text: Joi.string()
    .trim()
    .min(1)
    .max(200)
    .required()
    .messages({
      'string.min': 'Location text must be at least 1 character',
      'string.max': 'Location text must not exceed 200 characters',
      'any.required': 'Location text is required',
      'string.empty': 'Location text cannot be empty'
    }),
  geo: Joi.object({
    lat: Joi.number()
      .min(-90)
      .max(90)
      .required()
      .messages({
        'number.min': 'Latitude must be between -90 and 90',
        'number.max': 'Latitude must be between -90 and 90',
        'any.required': 'Latitude is required'
      }),
    lng: Joi.number()
      .min(-180)
      .max(180)
      .required()
      .messages({
        'number.min': 'Longitude must be between -180 and 180',
        'number.max': 'Longitude must be between -180 and 180',
        'any.required': 'Longitude is required'
      })
  })
    .required()
    .messages({
      'any.required': 'Geographic coordinates are required'
    })
}).required();

// Schema for creating a trip offer
const createTripOfferSchema = Joi.object({
  vehicleId: Joi.string()
    .pattern(/^[a-f\d]{24}$/i)
    .required()
    .messages({
      'string.pattern.base': 'vehicleId must be a valid MongoDB ObjectId',
      'any.required': 'vehicleId is required',
      'string.empty': 'vehicleId cannot be empty'
    }),
  origin: geoLocationSchema.messages({
    'any.required': 'origin is required'
  }),
  destination: geoLocationSchema.messages({
    'any.required': 'destination is required'
  }),
  departureAt: Joi.date()
    .iso()
    .required()
    .messages({
      'date.format': 'departureAt must be a valid ISO 8601 date',
      'any.required': 'departureAt is required',
      'date.base': 'departureAt must be a valid date'
    }),
  estimatedArrivalAt: Joi.date()
    .iso()
    .greater(Joi.ref('departureAt'))
    .required()
    .messages({
      'date.format': 'estimatedArrivalAt must be a valid ISO 8601 date',
      'date.greater': 'estimatedArrivalAt must be after departureAt',
      'any.required': 'estimatedArrivalAt is required',
      'date.base': 'estimatedArrivalAt must be a valid date'
    }),
  pricePerSeat: Joi.number()
    .min(0)
    .precision(2)
    .required()
    .messages({
      'number.min': 'pricePerSeat must be 0 or greater',
      'number.base': 'pricePerSeat must be a number',
      'any.required': 'pricePerSeat is required'
    }),
  totalSeats: Joi.number()
    .integer()
    .min(1)
    .required()
    .messages({
      'number.base': 'totalSeats must be a number',
      'number.integer': 'totalSeats must be an integer',
      'number.min': 'totalSeats must be at least 1',
      'any.required': 'totalSeats is required'
    }),
  status: Joi.string()
    .valid('draft', 'published')
    .default('published')
    .optional()
    .messages({
      'any.only': 'status must be either "draft" or "published"'
    }),
  notes: Joi.string()
    .max(500)
    .trim()
    .allow('')
    .default('')
    .optional()
    .messages({
      'string.max': 'notes must not exceed 500 characters'
    })
}).options({
  abortEarly: false,
  stripUnknown: true
});

// Schema for updating a trip offer
const updateTripOfferSchema = Joi.object({
  pricePerSeat: Joi.number()
    .min(0)
    .precision(2)
    .optional()
    .messages({
      'number.min': 'pricePerSeat must be 0 or greater',
      'number.base': 'pricePerSeat must be a number'
    }),
  totalSeats: Joi.number()
    .integer()
    .min(1)
    .optional()
    .messages({
      'number.base': 'totalSeats must be a number',
      'number.integer': 'totalSeats must be an integer',
      'number.min': 'totalSeats must be at least 1'
    }),
  status: Joi.string()
    .valid('draft', 'published', 'canceled')
    .optional()
    .messages({
      'any.only': 'status must be one of: draft, published, canceled'
    }),
  notes: Joi.string()
    .max(500)
    .trim()
    .allow('')
    .optional()
    .messages({
      'string.max': 'notes must not exceed 500 characters'
    })
})
  .min(1)
  .options({
    abortEarly: false,
    stripUnknown: true
  })
  .messages({
    'object.min': 'At least one field must be provided for update'
  });

// Schema for listing trip offers (query parameters)
const listTripsQuerySchema = Joi.object({
  status: Joi.alternatives()
    .try(
      Joi.string().valid('draft', 'published', 'canceled', 'completed'),
      Joi.array().items(Joi.string().valid('draft', 'published', 'canceled', 'completed'))
    )
    .optional()
    .messages({
      'any.only': 'status must be one of: draft, published, canceled, completed'
    }),
  fromDate: Joi.date()
    .iso()
    .optional()
    .messages({
      'date.format': 'fromDate must be a valid ISO 8601 date',
      'date.base': 'fromDate must be a valid date'
    }),
  toDate: Joi.date()
    .iso()
    .optional()
    .when('fromDate', {
      is: Joi.exist(),
      then: Joi.date().min(Joi.ref('fromDate')).messages({
        'date.min': 'toDate must be after fromDate'
      })
    })
    .messages({
      'date.format': 'toDate must be a valid ISO 8601 date',
      'date.base': 'toDate must be a valid date'
    }),
  page: Joi.number()
    .integer()
    .min(1)
    .default(1)
    .optional()
    .messages({
      'number.base': 'page must be a number',
      'number.integer': 'page must be an integer',
      'number.min': 'page must be at least 1'
    }),
  pageSize: Joi.number()
    .integer()
    .min(1)
    .max(50)
    .default(10)
    .optional()
    .messages({
      'number.base': 'pageSize must be a number',
      'number.integer': 'pageSize must be an integer',
      'number.min': 'pageSize must be at least 1',
      'number.max': 'pageSize must not exceed 50'
    })
}).options({
  abortEarly: false,
  stripUnknown: true
});

// Schema for trip ID parameter
const tripIdParamSchema = Joi.object({
  id: Joi.string()
    .pattern(/^[a-f\d]{24}$/i)
    .required()
    .messages({
      'string.pattern.base': 'Trip ID must be a valid MongoDB ObjectId',
      'any.required': 'Trip ID is required'
    })
}).options({
  abortEarly: false
});

// Schema for passenger trip search (query parameters)
const searchTripsQuerySchema = Joi.object({
  qOrigin: Joi.string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .messages({
      'string.min': 'qOrigin must be at least 1 character',
      'string.max': 'qOrigin must not exceed 100 characters'
    }),
  qDestination: Joi.string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .messages({
      'string.min': 'qDestination must be at least 1 character',
      'string.max': 'qDestination must not exceed 100 characters'
    }),
  fromDate: Joi.date()
    .iso()
    .optional()
    .messages({
      'date.format': 'fromDate must be a valid ISO 8601 date',
      'date.base': 'fromDate must be a valid date'
    }),
  toDate: Joi.date()
    .iso()
    .optional()
    .when('fromDate', {
      is: Joi.exist(),
      then: Joi.date().min(Joi.ref('fromDate')).messages({
        'date.min': 'toDate must be after fromDate'
      })
    })
    .messages({
      'date.format': 'toDate must be a valid ISO 8601 date',
      'date.base': 'toDate must be a valid date'
    }),
  page: Joi.number()
    .integer()
    .min(1)
    .default(1)
    .optional()
    .messages({
      'number.base': 'page must be a number',
      'number.integer': 'page must be an integer',
      'number.min': 'page must be at least 1'
    }),
  pageSize: Joi.number()
    .integer()
    .min(1)
    .max(50)
    .default(10)
    .optional()
    .messages({
      'number.base': 'pageSize must be a number',
      'number.integer': 'pageSize must be an integer',
      'number.min': 'pageSize must be at least 1',
      'number.max': 'pageSize must not exceed 50'
    })
}).options({
  abortEarly: false,
  stripUnknown: true
});

module.exports = {
  createTripOfferSchema,
  updateTripOfferSchema,
  listTripsQuerySchema,
  tripIdParamSchema,
  searchTripsQuerySchema
};

