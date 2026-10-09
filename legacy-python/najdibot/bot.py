import asyncio
import hashlib
import html
import os

from aiogram import Bot, Dispatcher
from aiogram.types import (
    InlineQuery,
    InlineQueryResultArticle,
    InputTextMessageContent,
)

from .platforms import search_links

dp = Dispatcher()


@dp.inline_query()
async def on_inline(inline: InlineQuery):
    query = inline.query.strip()
    if len(query) < 2:
        return await inline.answer([], cache_time=1)

    results = []
    for name, url in search_links(query):
        results.append(
            InlineQueryResultArticle(
                id=hashlib.md5(f"{name}{query}".encode()).hexdigest(),
                title=name,
                description=f"Искать «{query}»",
                input_message_content=InputTextMessageContent(
                    message_text=f'<a href="{html.escape(url)}">{name}: {html.escape(query)}</a>',
                    parse_mode="HTML",
                ),
            )
        )
    await inline.answer(results, cache_time=300)


async def main():
    bot = Bot(os.environ["BOT_TOKEN"])
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
