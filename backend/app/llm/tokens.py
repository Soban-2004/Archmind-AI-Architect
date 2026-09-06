"""
Rough token-count *estimation* for pre-flight budget checks — used only to
decide how much conversation history to send and whether a request is
worth attempting at all, before spending an actual API call finding out
the hard way (see the incident this exists to prevent: a long project's
full message history pushed one request to 9,362 tokens against Groq's
free-tier 8,000 tokens/minute limit, which surfaced as an unhandled
crash — services/interview.py now catches that too, but this stops it
from happening in the first place for the common case).

Deliberately NOT a real tokenizer: tiktoken doesn't ship an encoder for
every model (including the open-weight one this project uses), and
pulling in a heavy dependency just for an estimate is overkill when the
caller already keeps a comfortable safety margin. The standard
~4-characters-per-token rule of thumb for English text is accurate enough
for "should I trim more before sending this" — exactness isn't the job,
the real token count from the API response (see GroqProvider.last_usage)
is what actually gets shown to the user afterward.
"""

CHARS_PER_TOKEN = 4
PER_MESSAGE_OVERHEAD_TOKENS = 4  # role/formatting overhead, roughly


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN)


def estimate_messages_tokens(messages: list[dict]) -> int:
    return sum(estimate_tokens(m.get("content", "")) + PER_MESSAGE_OVERHEAD_TOKENS for m in messages)
