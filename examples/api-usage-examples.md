# API Usage Examples

The API documentation now lives on the site: **<https://azuretags.egbcorporate.org/api.html>**

It has copy-paste examples in PowerShell, curl and Python for:

- getting the current IP ranges of a service tag
- seeing what changed in the latest update
- getting told when something changes (a short daily check)

plus a list of every file and the change file format.

Quick start:

```bash
curl -s https://azuretags.egbcorporate.org/data/current.json \
  | jq -r '.values[] | select(.name == "Storage.WestEurope") | .properties.addressPrefixes[]'
```

To follow changes, read `/data/changes/manifest.json` and fetch only the change files newer than the last one you processed. Each change file already lists the exact prefixes added and removed per tag, so there is no need to download and compare full snapshots.
