# API Usage Examples

The API documentation now lives on the site: **<https://azuretags.egbcorporate.org/api.html>**

It covers every endpoint, the change file format, and tested examples in curl, Python and PowerShell for:

- getting the current prefixes of a service tag
- seeing what changed for a tag since a date
- finding which tags contain an IP address or CIDR
- polling once a day for new changes

Quick start:

```bash
curl -s https://azuretags.egbcorporate.org/data/current.json \
  | jq -r '.values[] | select(.name == "Storage.WestEurope") | .properties.addressPrefixes[]'
```

To follow changes, read `/data/changes/manifest.json` and fetch only the change files newer than the last one you processed. Each change file already lists the exact prefixes added and removed per tag, so there is no need to download and compare full snapshots.
