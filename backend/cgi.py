
# Shim for cgi module removed in Python 3.13
# Used by feedparser
from email.message import Message

def parse_header(line):
    """
    Parse a Content-type like header.
    Return the main content-type and a dictionary of options.
    """
    if not line:
        return ("", {})
    m = Message()
    m['content-type'] = line
    params = m.get_params()
    if not params:
        return ("", {})
    # params is [(content_type, ''), (param_name, param_value), ...]
    # We want (content_type, {param_name: param_value})
    key = params[0][0]
    pdict = dict(params[1:])
    return key, pdict
