"""`python -m qa` — то же, что `python -m qa.run`."""

import asyncio

from qa.run import main

asyncio.run(main())
