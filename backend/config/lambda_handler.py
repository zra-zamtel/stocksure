"""AWS Lambda HTTP entry point: API Gateway -> Mangum -> Django ASGI."""

from mangum import Mangum

from config.asgi import application

handler = Mangum(application, lifespan="off")
