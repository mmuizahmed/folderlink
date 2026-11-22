package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
)

// Canonical returns the signature form of v.
// Objects use sorted keys, numbers must be safe integers, and strings follow encoding/json
// with HTML escaping disabled so the result matches the TypeScript implementation.
func Canonical(v any) (string, error) {
	raw, err := marshal(v)
	if err != nil {
		return "", err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var generic any
	if err := dec.Decode(&generic); err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := writeCanon(&buf, generic); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func writeCanon(buf *bytes.Buffer, v any) error {
	switch t := v.(type) {
	case nil:
		buf.WriteString("null")
	case bool:
		if t {
			buf.WriteString("true")
		} else {
			buf.WriteString("false")
		}
	case json.Number:
		if !safeInteger(string(t)) {
			return fmt.Errorf("canonical JSON only accepts safe integers")
		}
		buf.WriteString(string(t))
	case string:
		s, err := marshal(t)
		if err != nil {
			return err
		}
		buf.Write(s)
	case []any:
		buf.WriteByte('[')
		for i, item := range t {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := writeCanon(buf, item); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(t))
		for key := range t {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		buf.WriteByte('{')
		for i, key := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			name, err := marshal(key)
			if err != nil {
				return err
			}
			buf.Write(name)
			buf.WriteByte(':')
			if err := writeCanon(buf, t[key]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
	default:
		return fmt.Errorf("unsupported canonical JSON value %T", v)
	}
	return nil
}

func safeInteger(s string) bool {
	if s == "" {
		return false
	}
	i := 0
	if s[0] == '-' {
		if len(s) == 1 {
			return false
		}
		i = 1
	}
	if s[i] == '0' && len(s) != i+1 {
		return false
	}
	for _, c := range s[i:] {
		if c < '0' || c > '9' {
			return false
		}
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return false
	}
	const maxSafe = int64(1<<53 - 1)
	return n <= maxSafe && n >= -maxSafe
}
